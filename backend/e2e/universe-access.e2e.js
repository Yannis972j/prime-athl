// Accès par univers : cases à cocher côté coach, effet immédiat côté athlète (écran des univers, bannière, serveur).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, id, tok;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const grant = body => api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body });
const access = async () => (await api(srv.baseUrl, 'GET', '/api/stripe/status', { token: tok })).body.access;

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'ua@test.local', password: PW, firstName: 'Kenji', lastName: 'Ua' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'ua@test.local', password: PW } });
  id = la.body.user.id; tok = la.body.token;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('serveur : par défaut seul le Catalogue est ouvert ; chaque case agit sur son univers', async () => {
  assert.deepEqual(await access(), { explorer: false, ia: false, coach: false, programmes: true });
  assert.equal((await grant({ universe: 'coach', enabled: true })).status, 200);
  assert.deepEqual(await access(), { explorer: false, ia: false, coach: true, programmes: true });
  await grant({ universe: 'programmes', enabled: false });
  assert.equal((await access()).programmes, false, 'catalogue décochable');
  assert.equal((await grant({ universe: 'nimporte', enabled: true })).status, 400);
  assert.equal((await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: tok, body: { all: true } })).status, 403, 'un athlète ne se donne pas d\'accès');
});
test('serveur : un choix explicite l\'emporte sur l\'accès complet ; Explorer ouvre les séances', async () => {
  await grant({ all: false });
  assert.equal((await api(srv.baseUrl, 'GET', '/api/seances', { token: tok })).status, 403);
  await api(srv.baseUrl, 'POST', `/api/access/grant/${id}`, { token: coach, body: { enabled: true } }); // accès complet
  await grant({ universe: 'ia', enabled: false });
  const a = await access();
  assert.equal(a.ia, false, 'IA décochée malgré l\'accès complet'); // décoché explicitement
  await grant({ universe: 'explorer', enabled: true });
  assert.equal((await api(srv.baseUrl, 'GET', '/api/seances', { token: tok })).status, 200);
  await api(srv.baseUrl, 'POST', `/api/access/grant/${id}`, { token: coach, body: { enabled: false } });
  await grant({ all: false });
});

async function login(email, pw) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', pw); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  return { ctx, pg, errs };
}

test('coach : cases à cocher dans « Accès & abonnement » ; athlète : écran des univers et bannière', async () => {
  await grant({ universe: 'programmes', enabled: true }); // état de départ : Catalogue seul
  const c = await login(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD);
  await c.pg.getByText('Kenji', { exact: false }).first().click(); await c.pg.waitForTimeout(1200);
  await c.pg.getByText('Accès & abonnement', { exact: false }).first().click(); await c.pg.waitForTimeout(600);
  const box = c.pg.getByTestId('universe-access');
  await box.scrollIntoViewIfNeeded();
  assert.equal((await c.pg.getByTestId('universe-count').innerText()).trim(), '1/4', 'Catalogue seul au départ');
  await c.pg.getByTestId('universe-coach').click(); await c.pg.waitForTimeout(1200);
  await c.pg.getByTestId('universe-explorer').click(); await c.pg.waitForTimeout(1200);
  assert.equal((await c.pg.getByTestId('universe-count').innerText()).trim(), '3/4');
  assert.equal(await c.pg.getByTestId('universe-coach').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await access(), { explorer: true, ia: false, coach: true, programmes: true });
  if (SHOT) await box.screenshot({ path: `${SHOT}/universe-card.png` });
  await c.pg.getByTestId('universe-coach').click(); await c.pg.waitForTimeout(1200); // décocher
  assert.equal((await access()).coach, false, 'décocher retire l\'accès');
  await c.pg.getByTestId('universe-coach').click(); await c.pg.waitForTimeout(1200);
  assert.deepEqual(c.errs, []);
  await c.ctx.close();

  const a = await login('ua@test.local', PW);
  for (const t of ['Passer', 'Plus tard']) { try { await a.pg.getByText(t, { exact: false }).first().click({ timeout: 1500 }); } catch {} }
  const txt = await a.pg.evaluate(() => document.body.innerText);
  assert.match(txt, /Abonnement requis/, 'IA encore verrouillée → bannière');
  assert.match(txt, /Non activé/, 'texte clair sur les univers verrouillés');
  if (SHOT) await a.pg.screenshot({ path: `${SHOT}/universe-athlete.png` });
  await a.ctx.close();
  await grant({ universe: 'ia', enabled: true });
  const a2 = await login('ua@test.local', PW);
  for (const t of ['Passer', 'Plus tard']) { try { await a2.pg.getByText(t, { exact: false }).first().click({ timeout: 1500 }); } catch {} }
  assert.doesNotMatch(await a2.pg.evaluate(() => document.body.innerText), /Abonnement requis|Débloquer Prime Athl/, 'tout débloqué → plus de bannière');
  assert.deepEqual(a2.errs, []);
  await a2.ctx.close();
});
