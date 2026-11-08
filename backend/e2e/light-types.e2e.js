// Les TROIS types d'allègement (décharge semaine, décharge séance, douleurs de cycle) produisent une séance marquée
// « décharge » → enregistrée côté serveur et affichée en corail sur le calendrier (athlète).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, token;
const EMAIL = 'e2e-light@test.local', PW = 'longenough1';
const today = new Date();
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayAgo = n => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
const TODAY = ymd(today);

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PW, firstName: 'Lea', lastName: 'Light' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PW } });
  token = la.body.token;
  await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { gender: 'f' } }); // « Douleurs de cycle » n'est proposé qu'aux femmes
  await api(srv.baseUrl, 'POST', `/api/access/grant/${la.body.user.id}`, { token: coach, body: { enabled: true } });
  const pex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 5, sets: [{ weight: 60, reps: 10, target: '10' }, { weight: 60, reps: 10, target: '10' }] });
  const days = {};
  for (const d of ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE']) days[d] = { category: 'JAMBES', exercises: [pex('Squat')] };
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${la.body.user.id}`, { token: coach, body: { data: { PROG: days }, fileName: 'p.xlsx' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function openDay(offset = 0) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) await click(t, 1500);
  const target = dayAgo(offset);
  if (target.getMonth() !== today.getMonth()) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(500); }
  await pg.locator(`[data-cal-date="${ymd(target)}"]`).click();
  await pg.waitForTimeout(700);
  return { ctx, pg, click, errs, date: ymd(target) };
}
async function play(pg, click) {
  // Jour d'aujourd'hui : « Démarrer la séance » ; jour déjà passé : « Valider à cette date » (enregistrée à cette date).
  if (!(await click('Démarrer la séance', 2500))) await click('Valider à cette date', 3000);
  await click("C'est parti", 1500);
  let idle = 0;
  for (let g = 0; g < 120 && idle < 8; g++) {
    const r = await pg.evaluate(() => {
      const ok = [...document.querySelectorAll('button')].find(b => b.style.width === '38px' && b.style.height === '38px' && b.parentElement.querySelector('button[style*="26px"]'));
      if (ok) { ok.click(); return 'set'; }
      const nx = [...document.querySelectorAll('button')].find(b => /^Suivant/.test(b.innerText.trim()) && !b.disabled);
      if (nx) { nx.click(); return 'next'; }
      return 'end';
    });
    idle = r === 'end' ? idle + 1 : 0;
    await pg.waitForTimeout(r === 'set' ? 350 : r === 'end' ? 1000 : 500);
  }
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (b) b.click(); });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3000);
}

// Un jour différent par type : un jour déjà « fait » ne propose plus les options d'allègement.
for (const [label, expectReason, offset] of [['Décharge semaine', undefined, 0], ['Décharge séance', 'session', 1], ['Douleurs de cycle', 'menstrual', 2]]) {
  test(`« ${label} » : la séance est enregistrée comme décharge`, async () => {
    const before = (await api(srv.baseUrl, 'GET', '/api/sessions', { token })).body.length;
    const { ctx, pg, click, errs } = await openDay(offset);
    assert.ok(await click(label, 3000), 'option proposée : ' + label);
    await play(pg, click);
    const list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token })).body;
    assert.equal(list.length, before + 1, 'une séance enregistrée');
    const mine = list.filter(x => x.deload && x.lightReason === expectReason);
    assert.ok(mine.length >= 1, `séance deload=true, lightReason=${expectReason} introuvable : ` + JSON.stringify(list.map(x => ({ d: x.deload, r: x.lightReason }))));
    assert.deepEqual(errs, []);
    await ctx.close();
  });
}

test('calendrier : les trois jours de décharge (semaine, séance, cycle) sont en corail', async () => {
  const { ctx, pg } = await openDay(0);
  await pg.locator(`[data-cal-date="${TODAY}"]`).click(); // désélectionne pour voir la couleur d'état
  await pg.waitForTimeout(400);
  const colorOf = ds => pg.evaluate(d => { const el = document.querySelector(`[data-cal-date="${d}"]`); return el && getComputedStyle(el.querySelector('span')).color; }, ds);
  const checked = [];
  for (const off of [0, 1, 2]) {
    const d = dayAgo(off);
    if (d.getMonth() !== today.getMonth()) continue; // autre mois : non visible sans changer de page
    checked.push(off);
    assert.equal(await colorOf(ymd(d)), 'rgb(242, 145, 107)', 'jour −' + off + ' en corail');
  }
  assert.ok(checked.length >= 1);
  if (process.env.SHOT_LIGHT) await pg.screenshot({ path: process.env.SHOT_LIGHT });
  await ctx.close();
});
