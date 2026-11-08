// Calendrier : une séance de DÉCHARGE s'affiche d'une couleur distincte (corail) du « fait » (vert), côté athlète ET côté coach,
// avec légende « Décharge » et badge dans le détail du jour.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coachTok, athleteId;
const EMAIL = 'e2e-deload@test.local', PW = 'longenough1';
const now = new Date();
// Mois PRÉCÉDENT : toujours dans le passé (le serveur refuse les séances faites datées du futur).
const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const dayStr = d => `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const iso = d => `${dayStr(d)}T12:00:00.000Z`;
const ex = (n) => ({ name: n, muscle: 'JAMBES', sets: [{ weight: 60, reps: 10, done: true }] });
const CORAIL = 'rgb(242, 145, 107)';

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coachTok = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachTok, body: { email: EMAIL, password: PW, firstName: 'Lea', lastName: 'Deload' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PW } });
  athleteId = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coachTok, body: { enabled: true } });
  // Un programme (sinon l'écran athlète n'affiche pas de calendrier)
  const pex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 60, sets: [{ weight: 60, reps: 10, target: '10' }] });
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${athleteId}`, { token: coachTok, body: { data: { PROGRAMME: { LUNDI: { category: 'JAMBES', exercises: [pex('Squat')] }, JEUDI: { category: 'DOS', exercises: [pex('Tirage')] } } }, fileName: 'p.xlsx' } });
  const post = (body) => api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coachTok, body });
  await post({ name: 'JAMBES', date: iso(3), exercises: [ex('Squat')], totalVolume: 600 });                           // normale
  await post({ name: 'JAMBES', date: iso(10), exercises: [ex('Squat')], totalVolume: 360, deload: true });            // décharge
  await post({ name: 'DOS', date: iso(14), exercises: [ex('Tirage')], totalVolume: 360, deload: true, lightReason: 'menstrual' }); // décharge (cycle) : même couleur
  await post({ name: 'PECS', date: iso(17), exercises: [ex('Dips')], totalVolume: 500 });                           // normale
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

const cellStyle = (pg, d) => pg.evaluate(ds => { const el = document.querySelector(`[data-cal-date="${ds}"]`); const cs = el && getComputedStyle(el); return el ? { border: cs.borderTopColor, color: getComputedStyle(el.querySelector('span')).color } : null; }, dayStr(d));

test('athlète : la décharge est corail, les séances normales restent vertes, légende « Décharge », badge dans le détail', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) await click(t, 1500);
  await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(500);
  await pg.waitForTimeout(800);
  const normal = await cellStyle(pg, 3), deload = await cellStyle(pg, 10), cycle = await cellStyle(pg, 14), normal2 = await cellStyle(pg, 17);
  assert.ok(normal && deload && cycle && normal2, 'cases du calendrier trouvées');
  assert.equal(deload.color, CORAIL, 'décharge : numéro corail');
  assert.equal(cycle.color, CORAIL, 'décharge « douleurs de cycle » : même couleur (neutre)');
  assert.notEqual(normal.color, CORAIL); assert.notEqual(normal2.color, CORAIL);
  assert.equal(normal.color, 'rgb(44, 196, 160)', 'séance normale : vert');
  assert.match(await pg.evaluate(() => document.body.innerText), /Décharge/, 'légende');
  await pg.locator(`[data-cal-date="${dayStr(10)}"]`).click();
  await pg.waitForTimeout(500);
  assert.match(await pg.getByTestId('day-status').innerText(), /Décharge/);
  await pg.locator(`[data-cal-date="${dayStr(10)}"]`).scrollIntoViewIfNeeded();
  if (process.env.SHOT_ATH) await pg.screenshot({ path: process.env.SHOT_ATH });
  await pg.locator(`[data-cal-date="${dayStr(3)}"]`).click();
  await pg.waitForTimeout(400);
  assert.match(await pg.getByTestId('day-status').innerText(), /Fait/);
  assert.doesNotMatch(await pg.getByTestId('day-status').innerText(), /Décharge/);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('coach : même couleur dans le calendrier de l\'athlète, légende et badge dans le détail', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(2500);
  try { await pg.getByText('Lea', { exact: false }).first().click({ timeout: 3000 }); } catch {}
  await pg.waitForTimeout(800);
  try { await pg.getByText('Séances', { exact: true }).first().click({ timeout: 3000 }); } catch {}
  await pg.waitForTimeout(800);
  await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(500);
  const normal = await cellStyle(pg, 3), deload = await cellStyle(pg, 10), cycle = await cellStyle(pg, 14);
  assert.equal(deload.color, CORAIL); assert.equal(cycle.color, CORAIL); assert.equal(normal.color, 'rgb(44, 196, 160)');
  assert.match(await pg.evaluate(() => document.body.innerText), /Décharge/, 'légende');
  await pg.locator(`[data-cal-date="${dayStr(10)}"]`).click();
  await pg.waitForTimeout(500);
  await pg.getByTestId('cal-deload-badge').waitFor();
  await pg.locator(`[data-cal-date="${dayStr(10)}"]`).scrollIntoViewIfNeeded();
  if (process.env.SHOT_COACH) await pg.screenshot({ path: process.env.SHOT_COACH });
  assert.deepEqual(errs, []);
  await ctx.close();
});
