// Feedback déjà lu : il ré-apparaît en pop-up à CHAQUE ouverture de la même séance (même nom), jamais pour une autre séance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, id, tok;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const lex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 5, sets: [{ weight: 60, reps: 10, target: '10' }] });
const done = (n, w, r) => ({ name: n, muscle: 'JAMBES', sets: [{ weight: w, reps: r, done: true }] });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'pa@test.local', password: PW, firstName: 'Laura', lastName: 'Pa' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'pa@test.local', password: PW } });
  id = la.body.user.id; tok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${id}`, { token: coach, body: { sessions: [
    { id: 'a', name: 'BAS DU CORPS', sheetName: 'T', category: 'JAMBES', exercises: [lex('Squat')] },
    { id: 'b', name: 'HAUT DU CORPS', sheetName: 'T', category: 'DOS', exercises: [lex('Tirage')] }] } });
  const s = await api(srv.baseUrl, 'POST', '/api/sessions', { token: tok, body: { name: 'BAS DU CORPS', date: new Date(Date.now() - 3 * 86400000).toISOString(), totalVolume: 600, exercises: [done('Squat', 100, 10)] } });
  await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/overload`, { token: coach, body: { sessionId: s.body.id, sessionName: 'BAS DU CORPS', updates: [{ name: 'Squat', weight: 102.5, from: 100 }] } });
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${s.body.id}/feedback`, { token: coach, body: { feedback: 'Garde 2 minutes de repos sur les séries lourdes.' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function start(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', 'pa@test.local'); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 1500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  try { const m = pg.getByText(/^Merci$|^Merci 🔥/).first(); await m.waitFor({ timeout: 3000 }); await m.evaluate(el => el.click()); await pg.waitForTimeout(500); } catch {}
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', name, 'Commencer la séance', "C'est parti"]) await click(t);
  await pg.waitForTimeout(800);
  return { ctx, pg, errs };
}
const popup = pg => pg.getByText("Merci, c'est noté", { exact: false });

test('1er lancement : pop-up (feedback en attente) ; après « Merci », relancer la même séance le fait revenir', async () => {
  let { ctx, pg, errs } = await start('BAS DU CORPS');
  assert.equal(await popup(pg).count(), 1, 'pop-up au 1er lancement');
  assert.match(await pg.evaluate(() => document.body.innerText), /Garde 2 minutes de repos/);
  await popup(pg).first().evaluate(el => el.click()); await pg.waitForTimeout(1000);
  assert.equal(await popup(pg).count(), 0, 'fermé');
  assert.deepEqual(errs, []); await ctx.close();
  // l'acquittement est enregistré côté serveur
  assert.equal(((await api(srv.baseUrl, 'GET', '/api/program', { token: tok })).body.pendingCoachFeedbacks || []).length, 0);
  // 2e lancement, nouvelle session navigateur : le feedback revient
  ({ ctx, pg, errs } = await start('BAS DU CORPS'));
  assert.equal(await popup(pg).count(), 1, 'le pop-up revient à l\'ouverture de la même séance');
  const t = await pg.evaluate(() => document.body.innerText);
  assert.match(t, /Garde 2 minutes de repos/);
  assert.match(t, /102\.5 kg/, 'avec la charge mise à jour');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/again-popup.png` });
  assert.deepEqual(errs, []); await ctx.close();
});

test('une autre séance (nom différent) ne déclenche aucun pop-up de feedback', async () => {
  const { ctx, pg, errs } = await start('HAUT DU CORPS');
  assert.equal(await popup(pg).count(), 0);
  assert.doesNotMatch(await pg.evaluate(() => document.body.innerText), /Garde 2 minutes de repos/);
  assert.deepEqual(errs, []); await ctx.close();
});
