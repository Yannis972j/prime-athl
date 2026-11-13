// Feedback sur le JOUR de la séance : carte du jour (athlète + coach), repères calendrier, « Pas encore de feedback » + Commenter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, la, id;
const PW = 'longenough1';
// Le navigateur du test tourne en America/Martinique (UTC-4) ; le runner CI en UTC. Les jours doivent donc être
// calculés en heure de Martinique, sinon entre 00 h et 04 h UTC le « jour » du test ≠ celui de l'app (échec horaire).
const mq = d => new Date(d.getTime() - 4 * 3600000); // lire ensuite avec les getters UTC
const key = d => { const m = mq(d); return m.getUTCFullYear() + '-' + String(m.getUTCMonth() + 1).padStart(2, '0') + '-' + String(m.getUTCDate()).padStart(2, '0'); };
const dayAgo = n => new Date(Date.now() - n * 86400000);
const done = (n, w, r) => ({ name: n, muscle: 'JAMBES', sets: [{ weight: w, reps: r, done: true }, { weight: w, reps: r, done: true }] });
const pex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 5, sets: [{ weight: 60, reps: 10, target: '10' }] });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'df@test.local', password: PW, firstName: 'Laura', lastName: 'Df' } });
  la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'df@test.local', password: PW } });
  id = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  const days = {}; for (const d of ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE']) days[d] = { category: 'PROGRAMME', exercises: [pex('Squat')] };
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${id}`, { token: coach, body: { data: { PROG: days }, fileName: 'p.xlsx' } });
  const A = await api(srv.baseUrl, 'POST', '/api/sessions', { token: la.body.token, body: { name: 'BAS DU CORPS', date: dayAgo(2).toISOString(), totalVolume: 5200, exercises: [done('Squat', 100, 10)] } });
  await api(srv.baseUrl, 'POST', '/api/sessions', { token: la.body.token, body: { name: 'HAUT DU CORPS', date: dayAgo(4).toISOString(), totalVolume: 3100, exercises: [done('Tirage', 50, 12)] } });
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${A.body.id}/feedback`, { token: coach, body: { feedback: 'Très belle séance, technique propre.\nContinue !' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function login(email, pw) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, isMobile: true, hasTouch: true, timezoneId: 'America/Martinique' });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', pw); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  return { ctx, pg, errs };
}
const goDay = async (pg, d) => {
  const now = mq(new Date()), want = mq(d);
  for (let i = 0; i < (now.getUTCFullYear() - want.getUTCFullYear()) * 12 + now.getUTCMonth() - want.getUTCMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${key(d)}"]`).click(); await pg.waitForTimeout(800);
};

test('athlète : le feedback est sur la carte du jour de la séance, avec un repère dans le calendrier', async () => {
  const { ctx, pg, errs } = await login('df@test.local', PW);
  try { const m = pg.getByText(/^Merci/).first(); await m.waitFor({ timeout: 4000 }); await m.evaluate(el => el.click()); await pg.waitForTimeout(600); } catch {}
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 1500 }); await pg.waitForTimeout(700); } catch {} }
  assert.equal(await pg.getByTestId('cal-feedback-dot').count(), 1, 'un seul jour a un feedback');
  await goDay(pg, dayAgo(2));
  assert.match(await pg.getByTestId('day-feedback').innerText(), /feedback de yannis[\s\S]*Très belle séance, technique propre\.\nContinue !/i);
  await goDay(pg, dayAgo(4));
  assert.equal(await pg.getByTestId('day-feedback').count(), 0, 'pas de feedback ce jour-là');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('coach : message sur la carte du jour ; « Pas encore de feedback » + Commenter sinon ; repère orange', async () => {
  const { ctx, pg, errs } = await login(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD);
  for (const t of ['Laura', 'Séances']) { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 2500 }); await pg.waitForTimeout(900); } catch {} }
  await goDay(pg, dayAgo(2));
  assert.match(await pg.getByTestId('day-feedback').innerText(), /Très belle séance, technique propre/);
  await goDay(pg, dayAgo(4));
  assert.match(await pg.getByTestId('day-feedback-pending').innerText(), /Pas encore de feedback/);
  assert.match(await pg.evaluate(() => document.body.innerText), /À commenter/, 'légende du calendrier');
  await pg.getByTestId('day-feedback-pending').getByText('Commenter', { exact: true }).click(); await pg.waitForTimeout(1200);
  assert.equal(await pg.getByTestId('coach-feedback-box').count(), 1, 'le formulaire de feedback s\'ouvre directement');
  assert.deepEqual(errs, []);
  await ctx.close();
});
