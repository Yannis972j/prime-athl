// Pop-up de fin d'accès (J-3 / J-2 / J-1) à l'ouverture de l'app : qui le reçoit, et le reçoit-on à NOUVEAU après une prolongation ?
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach;
const PW = 'longenough1';
const ids = {};

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  for (const n of ['a3', 'a2', 'a1', 'au', 'ar']) {
    await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: n + '@test.local', password: PW, firstName: n } });
    ids[n] = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: n + '@test.local', password: PW } })).body.user.id;
    await api(srv.baseUrl, 'POST', `/api/access/universes/${ids[n]}`, { token: coach, body: { all: true } });
  }
  await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ids.a3}`, { token: coach, body: { accessDays: 3 } });
  await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ids.a2}`, { token: coach, body: { accessDays: 2 } });
  await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ids.a1}`, { token: coach, body: { accessDays: 1 } });
  await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ids.ar}`, { token: coach, body: { accessDays: 3 } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function open(email, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  const pg = await c.newPage(); pg.setDefaultTimeout(8000);
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.waitForTimeout(1500);
  if (await pg.locator('input[type=email]').count()) { await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter'); }
  await pg.waitForTimeout(3500);
  return { c, pg };
}
const popupText = pg => pg.evaluate(() => /Plus que \d jours? d'accès|Dernier jour d'accès/i.exec(document.body.innerText)?.[0] || null);

test('J-3, J-2, J-1 : le pop-up s\'affiche à l\'ouverture ; accès illimité : rien', async () => {
  for (const [n, want] of [['a3', /Plus que 3 jours/i], ['a2', /Plus que 2 jours/i], ['a1', /Dernier jour/i]]) {
    const { c, pg } = await open(n + '@test.local');
    assert.match(String(await popupText(pg)), want, n);
    await c.close();
  }
  const { c, pg } = await open('au@test.local');
  assert.equal(await popupText(pg), null, 'illimité : pas de pop-up');
  await c.close();
});

test('« Plus tard » : le pop-up ne revient pas le même palier ; MAIS après une prolongation et un nouveau J-3 il doit revenir', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  let { pg } = await open('ar@test.local', ctx);
  assert.match(String(await popupText(pg)), /Plus que 3 jours/i);
  // « Plus tard » DU pop-up d'accès (la carte d'invitation aux notifications en a un aussi)
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Plus tard').find(x => /Plus que \d jours?/i.test(x.parentElement.innerText)); b.click(); });
  await pg.waitForTimeout(500);
  await pg.close();
  ({ pg } = await open('ar@test.local', ctx));
  assert.equal(await popupText(pg), null, 'déjà vu pour ce palier');
  await pg.close();
  // le coach prolonge (30 j) puis, plus tard, l'accès retombe à 3 jours : NOUVEAU cycle (nouvelle date de fin)
  await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ids.ar}`, { token: coach, body: { accessDays: 30 } });
  await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ids.ar}`, { token: coach, body: { accessDays: 3 } });
  ({ pg } = await open('ar@test.local', ctx));
  assert.match(String(await popupText(pg)), /Plus que 3 jours/i, 'nouvelle échéance → le pop-up revient');
  await ctx.close();
});
