// Chrono cardio (SKIERG, rameur…) : 10 s de préparation « prépare-toi », puis compte à rebours de la durée ;
// à la fin la série est validée (repos entre deux séries d'un intervalle, rien après la dernière).
// Horloge du navigateur pilotée (page.clock) : pas d'attente réelle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser;
const EMAIL = 'e2e-cardio@test.local', PASSWORD = 'longenough1';
const mk = (name, duree, n) => ({ name, muscle: 'CARDIO', style: 'CARDIO', restSeconds: 60, cardio: { distance: '', vitesse: '', inclinaison: '', duree }, sets: Array.from({ length: n }, () => ({ weight: 0, reps: 0, done: false })) });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PASSWORD, firstName: 'Cardio', lastName: 'E2E' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  await api(srv.baseUrl, 'POST', `/api/access/grant/${la.body.user.id}`, { token: coach, body: { enabled: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${la.body.user.id}`, { token: coach, body: { sessions: [{ id: 'c1', name: 'TEST CARDIO', sheetName: 'T', category: 'CARDIO',
    exercises: [mk('SKIERG', "5'", 1), mk('SKIERG SPRINTS', '10"', 3)] }] } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function openSession(focus) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (focus) await ctx.addInitScript(() => { try { localStorage.setItem('pa_focus_mode', '1'); } catch {} });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.clock.install();
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.clock.runFor(700); return true; } catch { return false; } };
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL);
  await pg.fill('input[type=password]', PASSWORD);
  await pg.keyboard.press('Enter');
  await pg.clock.runFor(4500);
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'TEST CARDIO', 'Commencer la séance', "C'est parti"]) await click(t, 1500);
  await pg.clock.runFor(800);
  const text = () => pg.evaluate(() => document.body.innerText);
  return { ctx, pg, click, text, errs };
}

test('chrono cardio : 10 s de préparation, puis la durée, puis « Cardio terminé » (sans repos après la dernière série)', async () => {
  const { ctx, pg, click, text, errs } = await openSession(false);
  assert.match(await text(), /Lancer le chrono · 5 min/);
  assert.match(await text(), /Départ après 10 s de préparation/);
  await click('Lancer le chrono');
  await pg.clock.runFor(1500);
  let t = await text();
  assert.match(t, /PRÉPARE-TOI|Prépare-toi/i);
  assert.match(t, /Passer le décompte/);
  assert.doesNotMatch(t, /−15s/, 'pas de réglage ±15 s pendant la préparation');
  await pg.clock.runFor(9000); // 10,5 s au total → GO
  t = await text();
  assert.match(t, /CARDIO EN COURS|Cardio en cours/i);
  assert.match(t, /[45]:\d\d/, 'compte à rebours en min:sec (5:00 → 4:5x)');
  await pg.clock.runFor(300000);
  await pg.clock.runFor(2000);
  t = await text();
  assert.match(t, /Cardio terminé/);
  assert.doesNotMatch(t, /REPOS/i, 'aucun repos après le dernier (et seul) set du cardio');
  assert.deepEqual(errs, [], 'aucune erreur JS');
  await ctx.close();
});

test('intervalles 3 × 10 s : chaque lancement = 10 s de prépa + 10 s d\'effort, repos entre les séries, « Passer le décompte » démarre tout de suite', async () => {
  const { ctx, pg, click, text, errs } = await openSession(false);
  await click('Suivant');
  assert.match(await text(), /SKIERG SPRINTS/);
  assert.match(await text(), /série 1\/3/);
  await click('Lancer le chrono');
  await pg.clock.runFor(1000);
  await click('Passer le décompte'); // départ immédiat
  assert.match(await text(), /série 1\/3/i);
  await pg.clock.runFor(11000);      // 10 s d'effort écoulées → série validée → repos
  await pg.clock.runFor(1500);
  let t = await text();
  assert.match(t, /Repos|REPOS/);
  await click('Passer le repos');
  await click('Lancer le chrono');
  assert.match(await text(), /série 2\/3|Prépare-toi/i);
  assert.deepEqual(errs, [], 'aucune erreur JS');
  await ctx.close();
});

test('mode focus : le cardio affiche sa durée et le bouton « Lancer le chrono » (pas poids/reps)', async () => {
  const { ctx, pg, text, errs } = await openSession(true);
  const t = await text();
  assert.match(t, /Lancer le chrono/);
  assert.match(t, /5 min/);
  assert.doesNotMatch(t, /répétitions/i, 'pas de champ reps pour un cardio chronométré');
  assert.deepEqual(errs, [], 'aucune erreur JS');
  await ctx.close();
});
