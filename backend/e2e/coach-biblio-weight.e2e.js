// Coach → Biblio d'un athlète : la charge de chaque exercice est affichée (et plus de « 4×? » quand les reps sont connues).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach;
const PW = 'longenough1';
const mk = (name, muscle, w, n, reps, extra = {}) => ({ name, muscle, style: 'CLASSIQUE', weightStr: String(w), repsStr: reps, restSeconds: 120, sets: Array.from({ length: n }, () => ({ weight: w, reps: 0, done: false, ...(reps ? { target: parseInt(reps), targetStr: reps } : {}) })), ...extra });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  const c = await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'bw@test.local', password: PW, firstName: 'Denis', lastName: 'Bw' } });
  const id = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'bw@test.local', password: PW } })).body.user.id;
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${id}`, { token: coach, body: { sessions: [{ id: 'lib1', name: 'PUSH · PEC / ÉPAULES', exercises: [
    mk('Développé couché haltères', 'PEC', 24, 4, '8-10'),
    mk('Développé militaire assis', 'EPAULES', 18, 4, ''),               // reps inconnues : pas de « ? »
    mk('Dips assistés', 'TRICEPS', 10, 3, '10-12', { assisted: true }),
    mk('Pompes', 'PEC', 0, 3, '15', { weightStr: 'PDC' }),
  ] }] } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('Biblio coach : charge de chaque exercice visible, reps cible lues, pas de « ? » trompeur', async () => {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1500 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  for (const t of ['Denis', 'Biblio', 'PUSH']) { await pg.getByText(t, { exact: false }).first().click({ timeout: 4000 }); await pg.waitForTimeout(900); }
  const w = await pg.getByTestId('biblio-ex-weight').allInnerTexts();
  assert.deepEqual(w, ['24 kg', '18 kg', '10 kg (assist.)', 'Poids du corps']);
  const body = await pg.evaluate(() => document.body.innerText);
  assert.match(body, /4×8-10/, 'les reps cible remplacent « ? »');
  assert.match(body, /4 séries/, 'reps inconnues : « 4 séries » plutôt que « 4×? »');
  assert.doesNotMatch(body, /×\s*\?/, 'plus de « × ? »');
  await pg.screenshot({ path: process.env.SHOT || '/tmp/biblio-poids.png' });
  assert.deepEqual(errs, []);
  await ctx.close();
});
