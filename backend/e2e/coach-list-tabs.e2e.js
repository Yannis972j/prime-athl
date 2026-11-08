// « Mes athlètes » : onglets Tous / Aujourd'hui / À commenter, avec compteurs et états vides.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ex = [{ name: 'Squat', muscle: 'JAMBES', sets: [{ weight: 60, reps: 10, done: true }] }];
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  // Séances faites par l'athlète lui-même (POST /api/sessions avec son token) pour qu'elles comptent « à commenter »
  const athletes = [['t1@test.local', 'Inaya', 'Moutachy', [{ h: 2 }]], ['t2@test.local', 'Mélanie', 'Janvier', [{ h: 50 }]], ['t3@test.local', 'Frederick', 'Fredal', [{ h: 30, fb: 'Top' }]], ['t4@test.local', 'Denis', 'Bredas', []], ['t5@test.local', 'Laura', 'Cal', [{ h: 1 }, { h: 74 }]]];
  for (const [email, f, l, ss] of athletes) {
    await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email, password: PW, firstName: f, lastName: l } });
    const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: PW } });
    for (const s of ss) {
      const r = await api(srv.baseUrl, 'POST', '/api/sessions', { token: la.body.token, body: { name: 'BAS DU CORPS', date: ago(s.h), totalVolume: 600, exercises: ex } });
      if (s.fb) await api(srv.baseUrl, 'POST', `/api/coach/sessions/${r.body.id}/feedback`, { token: coach, body: { feedback: s.fb } });
    }
  }
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('serveur : compteurs par athlète (aujourd\'hui, à commenter)', async () => {
  const list = (await api(srv.baseUrl, 'GET', '/api/coach/athletes', { token: coach })).body.athletes;
  const by = n => list.find(a => a.firstName === n);
  assert.equal(by('Inaya').pendingFeedbackCount, 1);
  assert.equal(by('Frederick').pendingFeedbackCount, 0, 'feedback déjà donné');
  assert.equal(by('Denis').pendingFeedbackCount, 0);
  assert.equal(by('Laura').pendingFeedbackCount, 2);
});

test('onglets : Tous / Aujourd\'hui / À commenter filtrent la liste, avec compteurs', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'America/Martinique' });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const tabs = pg.getByTestId('coach-list-tabs');
  await tabs.waitFor();
  const count = async k => (await pg.getByTestId('tab-' + k).locator('span').first().innerText()).trim();
  assert.equal(await count('all'), '5');
  const names = async () => (await pg.evaluate(() => [...document.querySelectorAll('[data-testid="coach-list-tabs"] ~ div > div')].map(c => c.innerText.replace(/\n/g, ' '))));
  if (SHOT) await pg.screenshot({ path: `${SHOT}/tabs-1-tous.png` });
  await pg.getByTestId('tab-today').click(); await pg.waitForTimeout(400);
  const today = await count('today');
  assert.equal(today, '2', 'Inaya (il y a 2 h) et Laura (il y a 1 h) — si le test tourne juste après minuit, 0');
  assert.equal((await names()).length, 2);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/tabs-2-aujourdhui.png` });
  await pg.getByTestId('tab-pending').click(); await pg.waitForTimeout(400);
  assert.equal(await count('pending'), '3', 'Inaya, Mélanie, Laura (Frederick a eu son retour, Denis n\'a rien fait)');
  const order = await names();
  assert.match(order[0], /Mélanie/, 'la plus ancienne séance sans retour d\'abord');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/tabs-3-a-commenter.png` });
  // l'onglet est retenu au rechargement
  await pg.reload(); await pg.waitForTimeout(3500);
  assert.equal(await pg.getByTestId('tab-pending').getAttribute('aria-selected'), 'true');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('état vide : « Tout est à jour » quand plus rien à commenter', async () => {
  // donner un retour à toutes les séances en attente
  const list = (await api(srv.baseUrl, 'GET', '/api/coach/athletes', { token: coach })).body.athletes;
  for (const a of list) {
    const d = (await api(srv.baseUrl, 'GET', `/api/coach/athletes/${a.id}`, { token: coach })).body;
    for (const s of d.sessions) if (!s.coachFeedback) await api(srv.baseUrl, 'POST', `/api/coach/sessions/${s.id}/feedback`, { token: coach, body: { feedback: 'Bien joué' } });
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('pa_coach_list_tab', 'pending'); } catch {} });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  assert.match(await pg.getByTestId('coach-list-empty').innerText(), /Tout est à jour/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/tabs-4-vide.png` });
  await ctx.close();
});
