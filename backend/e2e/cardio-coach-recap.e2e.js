// Récap coach d'un SKIERG à séries : tableau par série, règle 95 %, et surcharge progressive +50 m
// validée par le coach → objectif imposé à l'athlète pour sa prochaine séance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, id, atok, sid, day;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ex = d => ({ name: 'SKIERG RESISTANCE', muscle: 'CARDIO', style: 'CARDIO', groupType: 'cardio', cardio: { duree: "2'" }, sets: d.map(x => ({ weight: 0, reps: 0, ...(x ? { distance: x } : {}) })) });
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'cr@test.local', password: PW, firstName: 'Inaya', lastName: 'Cr' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'cr@test.local', password: PW } });
  id = la.body.user.id; atok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${id}`, { token: coach, body: { sessions: [{ id: 'sr1', name: 'RESISTANCE SKIERG', sheetName: 'T', category: 'CARDIO', exercises: [ex([0, 0, 0])] }] } });
  const when = new Date(Date.now() - 2 * 86400000); day = ymd(when);
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, { token: coach, body: { name: 'RESISTANCE SKIERG', date: when.toISOString(), exercises: [ex([200, 200, 200])] } });
  sid = r.body.session?.id || r.body.id;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('serveur : l\'objectif en mètres est mémorisé, résumé dans la séance, non écrit dans le programme', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/overload`, { token: coach, body: { sessionId: sid, sessionName: 'RESISTANCE SKIERG', updates: [{ name: 'SKIERG RESISTANCE', distance: 250, from: 200 }] } });
  assert.equal(r.status, 200);
  const prog = (await api(srv.baseUrl, 'GET', '/api/program', { token: atok })).body;
  assert.equal(prog.targets['skierg resistance'].distance, 250);
  assert.equal(prog.targets['skierg resistance'].unit, 'm');
  const s = (await api(srv.baseUrl, 'GET', '/api/sessions', { token: atok })).body.find(x => x.id === sid);
  assert.equal(s.overloadApplied, true);
  // le récap en mètres est repris dans le pop-up feedback de l'athlète (« 200 → 250 m »)
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${sid}/feedback`, { token: coach, body: { feedback: 'Bien.' } });
  const pend = (await api(srv.baseUrl, 'GET', '/api/program', { token: atok })).body.pendingCoachFeedbacks;
  assert.deepEqual(pend[pend.length - 1].updates, [{ name: 'SKIERG RESISTANCE', from: 200, to: 250, unit: 'm' }]);
  // vider pour la suite du test UI
  await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, { token: coach, body: { name: 'x', date: new Date().toISOString(), exercises: [ex([100])] } }).catch(() => {});
});

test('coach : tableau par série + règle 95 % (Séance), carte +50 m (Récap) ; athlète : objectif « fixé par ton coach »', async () => {
  // état propre : on recrée une séance non « appliquée »
  const when = new Date(Date.now() - 3 * 86400000);
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, { token: coach, body: { name: 'RESISTANCE SKIERG', date: when.toISOString(), exercises: [ex([220, 210, 205])] } });
  const d3 = ymd(when);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Inaya'); await click('Séances');
  const now = new Date(), want = new Date(d3 + 'T12:00:00');
  for (let i = 0; i < (now.getFullYear() - want.getFullYear()) * 12 + now.getMonth() - want.getMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${d3}"]`).click(); await pg.waitForTimeout(600);
  // il y a une autre séance ce jour-là ? (non) → bouton Voir
  await pg.getByText('Voir', { exact: true }).first().click(); await pg.waitForTimeout(1200);
  const table = pg.getByTestId('coach-cardio-table');
  await table.waitFor();
  assert.equal(await pg.getByTestId('coach-cardio-row').count(), 3);
  assert.match(await pg.getByTestId('coach-cardio-total').innerText(), /635/);
  assert.match(await pg.getByTestId('coach-cardio-avg').innerText(), /212/);
  assert.match(await pg.getByTestId('coach-cardio-rule').innerText(), /94 %|93 %/); // 205/220 = 93 %
  assert.match(await pg.getByTestId('coach-cardio-rule').innerText(), /< 95 %/);
  if (SHOT) { await table.scrollIntoViewIfNeeded(); await pg.screenshot({ path: `${SHOT}/cr-1-table.png` }); }
  // Récap : carte de montée
  await pg.locator('button', { hasText: /^📊\s*Récap$/ }).first().click(); await pg.waitForTimeout(800);
  const card = pg.getByTestId('ov-cardio');
  await card.scrollIntoViewIfNeeded();
  assert.match(await card.innerText(), /règle non remplie/);
  await pg.getByTestId('ov-cardio-toggle').click(); await pg.waitForTimeout(300); // « Monter » malgré la règle : choix du coach
  assert.match(await pg.getByTestId('ov-cardio-target').innerText(), /262|260/);
  await card.locator('button', { hasText: '+' }).last().click(); await pg.waitForTimeout(200);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/cr-2-surcharge.png` });
  await pg.getByText('Valider · mettre à jour', { exact: false }).first().click(); await pg.waitForTimeout(1500);
  const prog = (await api(srv.baseUrl, 'GET', '/api/program', { token: atok })).body;
  const t = prog.targets['skierg resistance'];
  assert.ok(t && t.distance >= 260 && t.unit === 'm', 'objectif enregistré : ' + JSON.stringify(t));
  assert.deepEqual(errs, []);
  await ctx.close();
  // Athlète : l'objectif du coach s'affiche dans sa séance
  const a = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ap = await a.newPage(); ap.setDefaultTimeout(8000);
  await ap.goto(srv.baseUrl + '/Muscu.html');
  await ap.fill('input[type=email]', 'cr@test.local'); await ap.fill('input[type=password]', PW); await ap.keyboard.press('Enter');
  await ap.waitForTimeout(3500);
  const aclick = async (x, to = 1500) => { try { await ap.getByText(x, { exact: false }).first().click({ timeout: to }); await ap.waitForTimeout(700); } catch {} };
  for (const x of ['Merci', 'Passer', 'Plus tard', 'Coaching', 'Biblio', 'RESISTANCE SKIERG', 'Commencer la séance', "C'est parti"]) await aclick(x);
  const goal = await ap.getByTestId('cardio-goal').innerText();
  assert.match(goal, /Fixé par ton coach/);
  assert.match(await ap.getByTestId('cardio-goal-target').innerText(), /270[\s\u00a0]m/);
  await ap.getByText("Merci, c'est noté", { exact: false }).first().evaluate(el => el.click()).catch(() => {}); await ap.waitForTimeout(600);
  if (SHOT) await ap.screenshot({ path: `${SHOT}/cr-3-athlete.png` });
  await a.close();
});
