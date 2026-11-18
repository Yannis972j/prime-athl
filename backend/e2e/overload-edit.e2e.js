// Montée de charge : le coach peut CORRIGER une montée déjà validée (avant : bloquée après validation).
// Serveur : les charges sont écrasées (jamais cumulées), un exo remis sur « Garder » revient à la
// charge faite, le récap athlète ne garde que les vraies montées. UI : « Modifier les charges ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, id, atok, sidApi, sidUi, dayUi;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const exo = (name, w) => ({ name, muscle: 'JAMBES', style: 'MUSCU', groupType: 'classic', sets: [1, 2, 3].map(() => ({ weight: w, reps: 8 })) });
const mkSession = (name, daysAgo, w1, w2) => api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, {
  token: coach, body: { name, date: new Date(Date.now() - daysAgo * 86400000).toISOString(), exercises: [exo('SQUAT', w1), exo('PRESSE', w2)] },
});
const targets = async () => (await api(srv.baseUrl, 'GET', '/api/program', { token: atok })).body.targets || {};
const mySession = async sid => (await api(srv.baseUrl, 'GET', '/api/sessions', { token: atok })).body.find(x => x.id === sid);

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'oe@test.local', password: PW, firstName: 'Odile', lastName: 'Edit' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'oe@test.local', password: PW } });
  id = la.body.user.id; atok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  // Deux séances du même nom (le récap compare à la précédente) : API puis UI, chacune sa paire.
  await mkSession('JAMBES API', 12, 40, 90);
  const ra = await mkSession('JAMBES API', 5, 40, 90); sidApi = ra.body.session?.id || ra.body.id;
  await mkSession('JAMBES UI', 11, 40, 90);
  const r = await mkSession('JAMBES UI', 3, 40, 90);
  sidUi = r.body.session?.id || r.body.id; dayUi = ymd(new Date(Date.now() - 3 * 86400000));
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('serveur : une montée validée peut être corrigée — charges écrasées, exo « gardé » revient à la charge faite', async () => {
  const post = body => api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/overload`, { token: coach, body: { sessionId: sidApi, sessionName: 'JAMBES API', ...body } });
  let r = await post({ updates: [{ name: 'SQUAT', weight: 42.5, from: 40 }, { name: 'PRESSE', weight: 100, from: 90 }] });
  assert.equal(r.status, 200);
  let t = await targets();
  assert.equal(t['squat'].weight, 42.5); assert.equal(t['presse'].weight, 100);
  assert.equal((await mySession(sidApi)).overloadApplied, true);

  // Correction : SQUAT 45, PRESSE remise sur « Garder » (revient à 90).
  r = await post({ correction: true, updates: [{ name: 'SQUAT', weight: 45, from: 40 }, { name: 'PRESSE', weight: 90, from: 90 }] });
  assert.equal(r.status, 200);
  t = await targets();
  assert.equal(t['squat'].weight, 45, 'écrasé, pas 42,5 + 45');
  assert.equal(t['presse'].weight, 90, 'revenu à la charge faite');
  const s = await mySession(sidApi);
  assert.equal(s.overloadApplied, true);
  assert.deepEqual(s.overloadUpdates.map(u => [u.name, u.from, u.to]), [['SQUAT', 40, 45]], 'le récap ne garde que les vraies montées');
});

test('coach (UI) : « Modifier les charges » après validation, enregistrer la correction, annuler', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Odile'); await click('Séances');
  const now = new Date(), want = new Date(dayUi + 'T12:00:00');
  for (let i = 0; i < (now.getFullYear() - want.getFullYear()) * 12 + now.getMonth() - want.getMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${dayUi}"]`).click(); await pg.waitForTimeout(600);
  await pg.getByText('Voir', { exact: true }).first().click(); await pg.waitForTimeout(1200);
  await pg.locator('button', { hasText: /^📊\s*Récap$/ }).first().click(); await pg.waitForTimeout(800);

  // La validation referme le récap (rechargement) : on le rouvre depuis la carte « Recap » du calendrier.
  const reopen = async () => {
    await pg.waitForTimeout(800);
    if (await pg.getByTestId('ov-edit').count()) return;
    await pg.getByText('Recap', { exact: true }).first().click(); await pg.waitForTimeout(1500);
  };

  // 1) première validation : « Monter » sur SQUAT (1er exo) → 41 kg proposés
  await pg.getByText('Monter', { exact: true }).first().scrollIntoViewIfNeeded();
  await pg.getByText('Monter', { exact: true }).first().click(); await pg.waitForTimeout(300);
  await pg.getByText('Valider · mettre à jour', { exact: false }).first().click(); await pg.waitForTimeout(1500);
  assert.equal((await targets())['squat'].weight, 41);
  // la fenêtre reste OUVERTE après la validation (avant : elle se refermait, la mise à jour « disparaissait »)
  assert.equal(await pg.getByTestId('ov-edit').count(), 1, 'récap toujours ouvert avec « Modifier les charges »');
  await reopen();
  const applied = pg.getByTestId('ov-applied');
  await applied.waitFor();
  assert.match(await applied.innerText(), /SQUAT[\s\S]*40 → 41 kg/);
  if (SHOT) { await applied.scrollIntoViewIfNeeded(); await pg.screenshot({ path: `${SHOT}/oe-1-applied.png` }); }

  // 2) annuler la correction : on revient à l'état « appliqué », rien n'a changé
  await pg.getByTestId('ov-edit').click(); await pg.waitForTimeout(400);
  await pg.getByTestId('ov-edit-hint').waitFor();
  await pg.getByTestId('ov-edit-cancel').click(); await pg.waitForTimeout(400);
  await pg.getByTestId('ov-edit').waitFor();
  assert.equal((await targets())['squat'].weight, 41);

  // 3) correction : SQUAT +1 (→ 42), enregistrée ; écrase 41, ne s'additionne pas
  await pg.getByTestId('ov-edit').click(); await pg.waitForTimeout(400);
  const hint = pg.getByTestId('ov-edit-hint'); await hint.waitFor();
  if (SHOT) { await hint.scrollIntoViewIfNeeded(); await pg.screenshot({ path: `${SHOT}/oe-2-edit.png` }); }
  await pg.locator('button', { hasText: /^\+$/ }).first().click(); await pg.waitForTimeout(200);
  await pg.getByText('Enregistrer la correction', { exact: false }).first().click(); await pg.waitForTimeout(1500);
  assert.equal((await targets())['squat'].weight, 42);
  await reopen();
  assert.match(await pg.getByTestId('ov-applied').innerText(), /40 → 42 kg/);
  const s = await mySession(sidUi);
  assert.deepEqual(s.overloadUpdates.map(u => [u.name, u.from, u.to]), [['SQUAT', 40, 42]]);

  // 4) correction : SQUAT remis sur « Garder » → revient à 40 (charge faite), plus de montée affichée
  await pg.getByTestId('ov-edit').click(); await pg.waitForTimeout(400);
  await pg.getByText('Garder', { exact: true }).first().click(); await pg.waitForTimeout(300);
  await pg.getByText('Enregistrer la correction', { exact: false }).first().click(); await pg.waitForTimeout(1500);
  assert.equal((await targets())['squat'].weight, 40);
  assert.equal((await mySession(sidUi)).overloadUpdates, undefined, 'plus aucune montée annoncée à l\'athlète');
  await reopen();
  assert.equal(await pg.getByTestId('ov-applied').count(), 0);
  assert.deepEqual(errs, []);
  await ctx.close();
});
