// SKIERG RESISTANCE : objectif du jour (moyenne + 50 m si la dernière série tient ≥ 95 % de la 1re), bilan en direct.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ex = (distances) => ({ name: 'SKIERG RESISTANCE', muscle: 'CARDIO', style: 'CARDIO', groupType: 'cardio', cardio: { duree: "2'" }, sets: distances.map(d => ({ weight: 0, reps: 0, ...(d ? { distance: d } : {}) })) });

async function mkAthlete(email, first, history) {
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email, password: PW, firstName: first, lastName: 'Prog' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: PW } });
  const id = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${id}`, { token: coach, body: { enabled: true } });
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${id}`, { token: coach, body: { sessions: [{ id: 'sr1', name: 'RESISTANCE SKIERG', sheetName: 'T', category: 'CARDIO', exercises: [ex([0, 0, 0])] }] } });
  if (history) await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, { token: coach, body: { name: 'RESISTANCE SKIERG', date: new Date(Date.now() - 7 * 86400000).toISOString(), exercises: [ex(history)] } });
}
before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await mkAthlete('rp-ok@test.local', 'Inaya', [200, 200, 200]);
  await mkAthlete('rp-drop@test.local', 'Lea', [220, 200, 160]);
  await mkAthlete('rp-new@test.local', 'Nina', null);
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function openCard(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Merci', 'Passer', 'Plus tard', 'Coaching', 'Biblio', 'RESISTANCE SKIERG', 'Commencer la séance', "C'est parti"]) await click(t, 1500);
  const card = pg.getByTestId('cardio-distance');
  await card.waitFor();
  return { ctx, pg, card, errs };
}
const fill = async (card, vals) => { const ins = card.locator('input'); for (let i = 0; i < vals.length; i++) await ins.nth(i).fill(String(vals[i])); };

test('200 · 200 · 200 : objectif 250 m par série, puis bilan en direct « prochain objectif »', async () => {
  const { ctx, pg, card, errs } = await openCard('rp-ok@test.local');
  const goal = await pg.getByTestId('cardio-goal').innerText();
  assert.match(goal, /OBJECTIF DU JOUR/i);
  assert.match(await pg.getByTestId('cardio-goal-target').innerText(), /250[\s ]m/);
  const why = await pg.getByTestId('cardio-goal-why').innerText();
  assert.match(why, /200 · 200 · 200/); assert.match(why, /moyenne 200[\s\u00a0]m/); assert.match(why, /100 %/);
  assert.equal(await card.locator('input').first().getAttribute('placeholder'), '250');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/prog-1-objectif.png` });
  await fill(card, [250, 250, 250]); await pg.waitForTimeout(300);
  const live = await pg.getByTestId('cardio-live').innerText();
  assert.match(live, /moyenne 250[\s\u00a0]m/); assert.match(live, /✓ atteint/); assert.match(live, /prochain objectif : 300[\s\u00a0]m par série/);
  if (SHOT) { await pg.getByTestId('cardio-live').scrollIntoViewIfNeeded(); await pg.screenshot({ path: `${SHOT}/prog-2-bilan-ok.png` }); }
  assert.deepEqual(errs, []); await ctx.close();
});

test('chute de la 3e série (220 · 200 · 160 → 73 %) : pas de +50, objectif = moyenne 193 m', async () => {
  const { ctx, pg, card, errs } = await openCard('rp-drop@test.local');
  assert.match(await pg.getByTestId('cardio-goal-target').innerText(), /193[\s ]m/);
  assert.match(await pg.getByTestId('cardio-goal-why').innerText(), /73 %.*tiens ta moyenne/s);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/prog-3-chute.png` });
  await fill(card, [190, 190, 150]); await pg.waitForTimeout(300);
  const live = await pg.getByTestId('cardio-live').innerText();
  assert.match(live, /79 %/); assert.match(live, /pas de montée/);
  assert.deepEqual(errs, []); await ctx.close();
});

test('première fois (aucun historique) : règle expliquée, aucune cible inventée', async () => {
  const { ctx, pg, errs } = await openCard('rp-new@test.local');
  assert.equal(await pg.getByTestId('cardio-goal-target').count(), 0);
  assert.match(await pg.getByTestId('cardio-goal').innerText(), /Pose ta base[\s\S]*\+50 m[\s\S]*95 %/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/prog-4-premiere.png` });
  assert.deepEqual(errs, []); await ctx.close();
});
