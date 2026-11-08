// « Ne pas commenter » : écarter les séances d'un athlète de l'onglet « À commenter » (en bloc ou séance par séance).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, ids = {}, sess = {};
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ex = [{ name: 'Squat', muscle: 'JAMBES', sets: [{ weight: 60, reps: 10, done: true }] }];
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const list = async () => (await api(srv.baseUrl, 'GET', '/api/coach/athletes', { token: coach })).body.athletes;
const stats = async n => (await list()).find(a => a.firstName === n);

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  for (const [email, f, l, hours] of [['s1@test.local', 'Laura', 'Cal', [26, 50]], ['s2@test.local', 'Inaya', 'Moutachy', [74]], ['s3@test.local', 'Mélanie', 'Janvier', [98]]]) {
    await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email, password: PW, firstName: f, lastName: l } });
    const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: PW } });
    ids[f] = la.body.user.id; sess[f] = [];
    for (const h of hours) sess[f].push((await api(srv.baseUrl, 'POST', '/api/sessions', { token: la.body.token, body: { name: 'BAS DU CORPS', date: ago(h), totalVolume: 600, exercises: ex } })).body.id);
  }
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('2 séances sans retour : en commenter une laisse l\'athlète « à commenter » (il en reste une)', async () => {
  assert.equal((await stats('Laura')).pendingFeedbackCount, 2);
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${sess.Laura[0]}/feedback`, { token: coach, body: { feedback: 'Bien' } });
  assert.equal((await stats('Laura')).pendingFeedbackCount, 1);
});

test('serveur : ne pas commenter une séance / en bloc, et reprendre', async () => {
  const S = id => api(srv.baseUrl, 'POST', `/api/coach/sessions/${id}/feedback-skip`, { token: coach, body: { skip: true } });
  assert.equal((await S(sess.Mélanie[0])).body.feedbackSkipped, true);
  assert.equal((await stats('Mélanie')).pendingFeedbackCount, 0);
  const back = await api(srv.baseUrl, 'POST', `/api/coach/sessions/${sess.Mélanie[0]}/feedback-skip`, { token: coach, body: { skip: false } });
  assert.equal(back.body.feedbackSkipped, false);
  assert.equal((await stats('Mélanie')).pendingFeedbackCount, 1);
  assert.equal((await api(srv.baseUrl, 'POST', `/api/coach/sessions/${sess.Mélanie[0]}/feedback-skip`, { token: coach, body: {} })).status, 400);
  assert.equal((await api(srv.baseUrl, 'POST', '/api/coach/sessions/nimporte/feedback-skip', { token: coach, body: { skip: true } })).status, 404);
});

async function login(tab) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'America/Martinique' });
  if (tab) await ctx.addInitScript(t => { try { localStorage.setItem('pa_coach_list_tab', t); } catch {} }, tab);
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  return { ctx, pg, errs };
}

test('onglet « À commenter » : bouton « Ne pas commenter » écarte l\'athlète de la liste', async () => {
  const { ctx, pg, errs } = await login('pending');
  const cards = () => pg.locator('[data-testid="coach-list-tabs"] ~ div > div');
  assert.equal(await cards().count(), 3);
  assert.equal((await pg.getByTestId('tab-pending').locator('span').first().innerText()).trim(), '3');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/skip-1-liste.png` });
  const target = cards().filter({ hasText: 'Inaya' });
  await target.getByTestId('skip-athlete').click(); await pg.waitForTimeout(1500);
  assert.equal(await cards().count(), 2, 'Inaya a disparu de la liste');
  assert.equal((await pg.getByTestId('tab-pending').locator('span').first().innerText()).trim(), '2');
  assert.equal((await stats('Inaya')).pendingFeedbackCount, 0);
  assert.equal((await stats('Inaya')).sessionCount, 1, 'la séance existe toujours');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/skip-2-apres.png` });
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('fiche séance : « Ne pas commenter cette séance » puis « Reprendre »', async () => {
  const { ctx, pg, errs } = await login();
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Mélanie'); await click('Séances');
  const when = new Date(Date.now() - 98 * 3600e3), day = ymd(new Date(when.toLocaleString('en-US', { timeZone: 'America/Martinique' })));
  const now = new Date(), want = new Date(day + 'T12:00:00');
  for (let i = 0; i < (now.getFullYear() - want.getFullYear()) * 12 + now.getMonth() - want.getMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${day}"]`).click(); await pg.waitForTimeout(600);
  await pg.getByText('Voir', { exact: true }).first().click(); await pg.waitForTimeout(1200);
  await pg.getByTestId('feedback-skip').scrollIntoViewIfNeeded();
  await pg.getByTestId('feedback-skip').click(); await pg.waitForTimeout(1000);
  assert.match(await pg.getByTestId('feedback-skipped').innerText(), /ne pas commenter/);
  assert.equal((await stats('Mélanie')).pendingFeedbackCount, 0);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/skip-3-fiche.png` });
  await pg.getByTestId('feedback-resume').click(); await pg.waitForTimeout(1000);
  assert.equal(await pg.getByTestId('feedback-skip').count(), 1, 'bouton de retour');
  assert.equal((await stats('Mélanie')).pendingFeedbackCount, 1, 'de nouveau à commenter');
  assert.deepEqual(errs, []);
  await ctx.close();
});
