// Deux séances le même jour : la puce choisie affiche le CONTENU de cette séance (exercices et séries réalisées),
// même quand le programme prévoit une autre séance ce jour-là.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, tok, day;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const today = new Date();
const ymdUTC = d => d.toISOString().slice(0, 10);
const pex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 5, sets: [{ weight: 60, reps: 10, target: '10' }] });
const done = (rows) => rows.map(([name, muscle, w, r]) => ({ name, muscle, sets: [{ weight: w, reps: r, done: true }, { weight: w, reps: r - 1, done: true }] }));

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'sc@test.local', password: PW, firstName: 'Inaya', lastName: 'Sc' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'sc@test.local', password: PW } });
  tok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${la.body.user.id}`, { token: coach, body: { all: true } });
  // programme sur les 7 jours : le jour choisi a une séance « prévue » différente des deux séances faites
  const days = {};
  for (const d of ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE']) days[d] = { category: 'PROGRAMME PRÉVU', exercises: [pex('Presse prévue')] };
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${la.body.user.id}`, { token: coach, body: { data: { PROG: days }, fileName: 'p.xlsx' } });
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 4)); day = ymdUTC(d);
  await api(srv.baseUrl, 'POST', '/api/sessions', { token: tok, body: { name: 'PUSH · ÉPAULES / TRICEPS', date: `${day}T10:41:00.000Z`, totalVolume: 900, exercises: done([['Hammer shoulder press', 'EPAULES', 40, 10], ['Extension triceps', 'TRICEPS', 25, 12]]) } });
  await api(srv.baseUrl, 'POST', '/api/sessions', { token: tok, body: { name: 'PULL · DOS / TRAPÈZES', date: `${day}T11:22:00.000Z`, totalVolume: 800, exercises: done([['Tirage vertical', 'DOS', 50, 10], ['Shrugs haltères', 'TRAPEZES', 20, 15]]) } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('la puce 2/2 montre les exercices de la 2e séance (pas ceux du programme)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'America/Martinique' });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', 'sc@test.local'); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async t => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 1500 }); await pg.waitForTimeout(700); } catch {} };
  for (const t of ['Merci', 'Passer', 'Plus tard', 'Coaching', 'Séances']) await click(t);
  const want = new Date(day + 'T12:00:00');
  for (let i = 0; i < (today.getFullYear() - want.getFullYear()) * 12 + today.getMonth() - want.getMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${day}"]`).click(); await pg.waitForTimeout(800);
  let txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /Hammer shoulder press/); assert.match(txt, /Extension triceps/);
  assert.doesNotMatch(txt, /Tirage vertical/); assert.doesNotMatch(txt, /Presse prévue/, 'plus le contenu du programme');
  assert.match(txt, /40 kg × 10\s+·\s+40 kg × 9/, 'séries réalisées');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/content-1.png` });
  await pg.locator('[data-testid="hist-sess-chip"]').nth(1).click(); await pg.waitForTimeout(600);
  txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /Tirage vertical/); assert.match(txt, /Shrugs haltères/);
  assert.doesNotMatch(txt, /Hammer shoulder press/);
  assert.match(txt, /PULL · DOS \/ TRAPÈZES/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/content-2.png` });
  assert.deepEqual(errs, []);
  await ctx.close();
});
