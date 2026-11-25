// « Séance prévue » (coach) : un exercice cardio affiche sa DURÉE (« 30 min »), jamais « 1 × 10 »
// (10 = répétitions par défaut de l'import, sans sens pour un tapis).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, athleteId;
const cardioEx = (name, cardio) => ({ name, muscle: 'TAPIS', style: 'CARDIO', restSeconds: 0, repsStr: '', cardio,
  sets: [{ weight: 0, reps: 0, target: 10, done: false }] });
const prog = { PROGRAMME: {
  DIMANCHE: { category: 'S4 · MARCHE TAPIS', exercises: [
    cardioEx('Tapis Liss', { duree: "30'", vitesse: '5', inclinaison: '8', distance: '' }),
    cardioEx('Tapis Distance', { duree: '', vitesse: '', inclinaison: '', distance: '3' }),
    cardioEx('Tapis Libre', { duree: '', vitesse: '', inclinaison: '', distance: '' }),
    { name: 'Squat', muscle: 'QUADRICEPS', style: 'CLASSIQUE', restSeconds: 90, repsStr: '8-10', weightStr: '80', sets: [{ weight: 80, reps: 0, target: 8, targetStr: '8-10', done: false }, { weight: 80, reps: 0, target: 8, targetStr: '8-10', done: false }, { weight: 80, reps: 0, target: 8, targetStr: '8-10', done: false }] },
  ] },
} };

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'tapis@test.local', password: 'longenough1', firstName: 'Tania', lastName: 'Tapis' } });
  athleteId = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'tapis@test.local', password: 'longenough1' } })).body.user.id;
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${athleteId}`, { token: coach, body: { data: prog, fileName: 'TANIA.xlsx' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('Séance prévue : cardio = durée (ou distance), plus de « 1 × 10 », musculation inchangée', async () => {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1100 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  const click = async (t) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 3000 }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Tania');
  try { await pg.getByText('Séances', { exact: true }).first().click({ timeout: 3000 }); } catch {}
  await pg.waitForTimeout(800);
  // un dimanche du mois en cours (jour du programme) → panneau du jour → « Voir » = fenêtre « Séance prévue »
  const now = new Date(); const sun = new Date(now.getFullYear(), now.getMonth(), 1);
  while (sun.getDay() !== 0) sun.setDate(sun.getDate() + 1);
  const ds = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
  await pg.locator(`[data-cal-date="${ds}"]`).click(); await pg.waitForTimeout(600);
  await pg.getByRole('button', { name: 'Voir', exact: true }).first().click(); await pg.waitForTimeout(600);
  const vols = await pg.getByTestId('day-ex-volume').allInnerTexts();
  assert.deepEqual(vols, ['30 min', '3 km', 'Cardio', '3×8-10']);
  const body = await pg.evaluate(() => document.body.innerText);
  assert.doesNotMatch(body, /1\s*×\s*10/, 'plus de « 1 × 10 »');
  assert.match(body, /⚡ 5 km\/h/); assert.match(body, /📐 8%/);
  if (process.env.SHOT) await pg.screenshot({ path: process.env.SHOT });
  assert.deepEqual(errs, []);
  await ctx.close();
});
