// Séance saisie par le coach pour un athlète : réponse perdue → reprise sans doublon ; réseau absent → la séance est
// gardée sur le téléphone puis envoyée toute seule au retour du réseau.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, athleteId, atok;
const body = (name, clientId) => ({ name, date: new Date(Date.now() - 3600e3).toISOString(), totalVolume: 600, duration: 40, clientId,
  exercises: [{ name: 'Squat', muscle: 'JAMBES', sets: [{ weight: 60, reps: 10, done: true }] }] });
const mine = async () => (await api(srv.baseUrl, 'GET', '/api/sessions', { token: atok })).body;

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'retry@test.local', password: 'longenough1', firstName: 'Rita', lastName: 'Retry' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'retry@test.local', password: 'longenough1' } });
  athleteId = la.body.user.id; atok = la.body.token;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function coachPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(10000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  return { ctx, pg, errs };
}

test('réponse perdue (le serveur a enregistré, le téléphone n\'a rien reçu) : la reprise ne crée pas de doublon', async () => {
  const { ctx, pg, errs } = await coachPage();
  let calls = 0;
  await pg.route('**/api/coach/athletes/*/sessions', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    calls++;
    if (calls === 1) { await r.fetch(); return r.abort(); }   // la requête arrive au serveur, la réponse est perdue
    return r.continue();
  });
  const n0 = (await mine()).length;
  const res = await pg.evaluate(([aid, b]) => window.postCoachSession(aid, b), [athleteId, body('LOST-RESPONSE', 'lost-1')]);
  assert.ok(res && res.id, 'la reprise aboutit');
  assert.equal(res.duplicate, true, 'le serveur reconnaît la séance déjà créée');
  assert.ok(calls >= 2, 'au moins une reprise');
  assert.equal((await mine()).length, n0 + 1, 'exactement une séance créée');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('erreur définitive (4xx) : pas de reprise inutile', async () => {
  const { ctx, pg } = await coachPage();
  let calls = 0;
  await pg.route('**/api/coach/athletes/*/sessions', r => { if (r.request().method() === 'POST') { calls++; return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"bad"}' }); } return r.continue(); });
  const err = await pg.evaluate(([aid, b]) => window.postCoachSession(aid, b).then(() => null, e => ({ status: e.status })), [athleteId, body('BAD', 'bad-1')]);
  assert.equal(err.status, 400);
  assert.equal(calls, 1, 'une seule tentative');
  await ctx.close();
});

test('séance gardée sur le téléphone (réseau absent) : envoyée automatiquement à la réouverture, une seule fois', async () => {
  const { ctx, pg } = await coachPage();
  const meId = await pg.evaluate(() => fetch('/api/me', { credentials: 'include' }).then(r => r.json()).then(u => u.id));
  const item = { athleteId, body: body('FROM-QUEUE', 'queue-1') };
  const n0 = (await mine()).length;
  await pg.evaluate(([k, it]) => localStorage.setItem(k, JSON.stringify([it])), ['pa_pending_coach_sessions_' + meId, item]);
  await pg.reload(); await pg.waitForTimeout(4000);
  assert.equal((await mine()).length, n0 + 1, 'séance de la file envoyée');
  assert.equal(await pg.evaluate(k => localStorage.getItem(k), 'pa_pending_coach_sessions_' + meId), '[]', 'file vidée');
  // 2e ouverture : rien n'est renvoyé
  await pg.reload(); await pg.waitForTimeout(3000);
  assert.equal((await mine()).length, n0 + 1, 'pas de doublon');
  await ctx.close();
});
