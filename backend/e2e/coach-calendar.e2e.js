// Calendrier coach : une séance FAITE sur un jour déplacé affiche son vrai intitulé et ses vrais muscles,
// jamais la catégorie du jour du programme (ex. « HAUT DU CORPS » à côté d'une séance « BAS DU CORPS »).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, athleteId;
const ex = (name, muscle) => ({ name, muscle, restSeconds: 60, sets: [{ weight: 50, reps: 10, target: '10' }] });
const prog = { PROGRAMME: {
  LUNDI: { category: 'BAS DU CORPS 1 — QUADRICEPS / FESSIERS', exercises: [ex('Squat', 'QUADRICEPS')] },
  MARDI: { category: 'HAUT DU CORPS 1 — DOS / ÉPAULES', exercises: [ex('Tirage', 'DOS')] },
} };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'cal@test.local', password: 'longenough1', firstName: 'Laura', lastName: 'Cal' } });
  athleteId = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'cal@test.local', password: 'longenough1' } })).body.user.id;
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${athleteId}`, { token: coach, body: { data: prog, fileName: 'LAURA.xlsx' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('séance faite un mardi où le lundi a été déplacé : intitulé et muscles = ceux de la séance faite', async () => {
  // un mardi du mois courant (≤ 28 pour rester dans le mois), et le lundi qui précède
  const now = new Date();
  let tue = new Date(now.getFullYear(), now.getMonth(), 8);
  while (tue.getDay() !== 2) tue.setDate(tue.getDate() + 1);
  const mon = new Date(tue); mon.setDate(tue.getDate() - 1);
  const mv = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/schedule-moves`, { token: coach, body: { fromDate: ymd(mon), toDate: ymd(tue), force: true } });
  assert.equal(mv.status, 200);
  await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body: {
    name: 'BAS DU CORPS 1 — QUADRICEPS / FESSIERS', date: ymd(tue) + 'T12:00:00.000Z', totalVolume: 9618,
    exercises: [{ name: 'Squat', muscle: 'QUADRICEPS', sets: [{ weight: 100, reps: 10, done: true }] }] } });
  // le déplacement est ensuite annulé côté données (ex. réimport) : le jour retombe sur le programme du mardi
  await api(srv.baseUrl, 'DELETE', `/api/coach/athletes/${athleteId}/schedule-moves/${ymd(tue)}`, { token: coach });

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL);
  await pg.fill('input[type=password]', MAIN_COACH_PASSWORD);
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(2500);
  const tryClick = async t => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 2500 }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  await tryClick('Laura');
  await tryClick('Séances');
  await pg.locator(`text=/^${tue.getDate()}$/`).first().click();
  await pg.waitForTimeout(500);
  const txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /BAS DU CORPS 1 — QUADRICEPS \/ FESSIERS/);
  assert.match(txt, /· QUADRICEPS/, 'muscles de la séance faite');
  assert.doesNotMatch(txt, /HAUT DU CORPS 1/, 'pas la catégorie du jour du programme');
  assert.deepEqual(errs, []);
  await pg.locator('text=/Mardi|Mercredi|Jeudi/').first().scrollIntoViewIfNeeded().catch(() => {});
  await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await pg.screenshot({ path: process.env.SHOT || '/tmp/cal.png' });
  await ctx.close();
});
