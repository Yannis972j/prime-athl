// Corrections : dates invalides, 2 séances le même jour (coach + athlète), bannière « Abonnement requis »,
// déplacement sur un jour occupé = échange, feedback coach lisible, prénom « Yannis ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, ath, athToken, free, freeToken;
const PW = 'longenough1';
const today = new Date();
const ymdUTC = d => d.toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - n));
const ex = (name, muscle) => ({ name, muscle, restSeconds: 5, sets: [{ weight: 50, reps: 10, target: '10' }] });
const done = (name, w) => [{ name, muscle: 'JAMBES', sets: [{ weight: w, reps: 10, done: true }] }];
const SHOT = process.env.SHOT_DIR;

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'sd@test.local', password: PW, firstName: 'Laura', lastName: 'Sd' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'sd@test.local', password: PW } });
  athToken = la.body.token; ath = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${ath}`, { token: coach, body: { enabled: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${ath}`, { token: coach, body: { data: { PROG: {
    LUNDI: { category: 'A', exercises: [ex('Squat', 'JAMBES')] },
    MARDI: { category: 'B', exercises: [ex('Tirage', 'DOS')] },
  } }, fileName: 'p.xlsx' } });
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'free@test.local', password: PW, firstName: 'Free', lastName: 'User' } });
  const fr = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'free@test.local', password: PW } });
  freeToken = fr.body.token; free = fr.body.user.id;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('dates : une date invalide ne casse plus rien (séance gardée, datée d\'aujourd\'hui)', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/sessions', { token: athToken, body: { name: 'Bad', date: 'pas une date', totalVolume: 10, exercises: done('Squat', 50) } });
  assert.equal(r.status, 200);
  const list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token: athToken })).body;
  const s = list.find(x => x.name === 'Bad');
  assert.ok(s && !isNaN(new Date(s.date).getTime()), 'date valide');
  assert.ok(Math.abs(Date.now() - new Date(s.date).getTime()) < 60000, 'datée de maintenant');
  const fut = await api(srv.baseUrl, 'POST', '/api/sessions', { token: athToken, body: { name: 'Fut', date: '2099-01-01T10:00:00Z', totalVolume: 10, exercises: done('Squat', 50) } });
  assert.equal(fut.status, 200);
  const f = (await api(srv.baseUrl, 'GET', '/api/sessions', { token: athToken })).body.find(x => x.name === 'Fut');
  assert.ok(new Date(f.date).getTime() < Date.now() + 27 * 3600e3, 'pas dans le futur');
});
test('dates : le coach reçoit 400 sur date invalide / future ; poids hors bornes refusé', async () => {
  const base = { name: 'X', exercises: done('Squat', 50), totalVolume: 1 };
  assert.equal((await api(srv.baseUrl, 'POST', `/api/coach/athletes/${ath}/sessions`, { token: coach, body: { ...base, date: 'nope' } })).body.error, 'invalid_date');
  assert.equal((await api(srv.baseUrl, 'POST', `/api/coach/athletes/${ath}/sessions`, { token: coach, body: { ...base, date: '2099-01-01T00:00:00Z' } })).body.error, 'date_in_future');
  assert.equal((await api(srv.baseUrl, 'POST', '/api/weight', { token: athToken, body: { weight: 9999 } })).body.error, 'invalid_weight');
  assert.equal((await api(srv.baseUrl, 'POST', '/api/weight', { token: athToken, body: { weight: 70, date: 'x' } })).status, 200);
});

test('échange : déplacer sur un jour occupé échange les deux séances, annuler les remet', async () => {
  const mon = '2026-11-02', tue = '2026-11-03';
  const U = `/api/coach/athletes/${ath}/schedule-moves`;
  assert.equal((await api(srv.baseUrl, 'POST', U, { token: coach, body: { fromDate: mon, toDate: tue } })).status, 409);
  const r = await api(srv.baseUrl, 'POST', U, { token: coach, body: { fromDate: mon, toDate: tue, force: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.scheduleMoves[tue].sourceDayName, 'LUNDI');
  assert.equal(r.body.scheduleMoves[mon].sourceDayName, 'MARDI', 'le mardi (B) n\'est pas effacé : il passe au lundi');
  const d = await api(srv.baseUrl, 'DELETE', `${U}/${tue}`, { token: coach });
  assert.deepEqual(d.body.scheduleMoves, {});
});

test('feedback : prénom « Yannis » (coach principal sans prénom), jamais « Ton coach »', async () => {
  const s = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${ath}/sessions`, { token: coach, body: { name: 'FB', date: daysAgo(9).toISOString(), exercises: done('Squat', 60), totalVolume: 600 } });
  const id = s.body.session?.id || s.body.id;
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${id}/feedback`, { token: coach, body: { feedback: 'Super séance.\nContinue comme ça.' } });
  const me = await api(srv.baseUrl, 'GET', '/api/program', { token: athToken });
  const pend = me.body.pendingCoachFeedbacks || (me.body.pendingCoachFeedback ? [me.body.pendingCoachFeedback] : []);
  assert.ok(pend.length, 'feedback en attente');
  assert.equal(pend[pend.length - 1].coachName, 'Yannis');
  const list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token: athToken })).body;
  assert.equal(list.find(x => x.id === id).coachFeedbackBy, 'Yannis');
});

async function login(email, password, tz = 'America/Martinique') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: tz });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', password); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  return { ctx, pg, errs, click };
}
// Pop-up de motivation (dès que l'athlète a plusieurs séances récentes) : on attend le bouton « Merci » puis on le clique.
const thanks = async pg => { try { const b = pg.getByText(/^Merci/).first(); await b.waitFor({ timeout: 5000 }); await b.evaluate(el => el.click()); await pg.waitForTimeout(600); } catch (e) { console.log('THANKS', String(e).slice(0, 200)); } };
const goToDate = async (pg, date) => {
  const want = new Date(date + 'T12:00:00');
  const diff = (today.getFullYear() - want.getFullYear()) * 12 + today.getMonth() - want.getMonth();
  for (let i = 0; i < diff; i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${date}"]`).click(); await pg.waitForTimeout(600);
};

test('deux séances le même jour : visibles côté athlète ET côté coach', async () => {
  const day = ymdUTC(daysAgo(4));
  for (const [name, h, w] of [['MATIN Jambes', '14', 60], ['SOIR Haut', '20', 40]]) {
    const r = await api(srv.baseUrl, 'POST', '/api/sessions', { token: athToken, body: { name, date: `${day}T${h}:00:00.000Z`, totalVolume: w * 10, exercises: done(name, w) } });
    assert.equal(r.status, 200);
  }
  // Athlète
  const a = await login('sd@test.local', PW);
  await thanks(a.pg); // pop-up de motivation (apparaît dès que l'athlète a plusieurs séances récentes)
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) await a.click(t, 1500);
  await goToDate(a.pg, day);
  assert.equal(await a.pg.locator('[data-testid="hist-sess-chip"]').count(), 2, 'deux puces côté athlète');
  let txt = await a.pg.evaluate(() => document.body.innerText);
  assert.match(txt, /MATIN Jambes/);
  await a.pg.locator('[data-testid="hist-sess-chip"]').nth(1).click(); await a.pg.waitForTimeout(500);
  txt = await a.pg.evaluate(() => document.body.innerText);
  assert.match(txt, /SOIR Haut/);
  if (SHOT) await a.pg.screenshot({ path: `${SHOT}/same-day-athlete.png` });
  assert.deepEqual(a.errs, []);
  await a.ctx.close();
  // Coach
  const c = await login(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD);
  await c.click('Laura', 3000); await c.click('Séances', 3000);
  await goToDate(c.pg, day);
  assert.equal(await c.pg.locator('[data-testid="cal-sess-chip"]').count(), 2, 'deux puces côté coach');
  await c.pg.locator('[data-testid="cal-sess-chip"]').nth(1).click(); await c.pg.waitForTimeout(400);
  txt = await c.pg.evaluate(() => document.body.innerText);
  assert.match(txt, /SOIR Haut/);
  if (SHOT) await c.pg.screenshot({ path: `${SHOT}/same-day-coach.png` });
  assert.deepEqual(c.errs, []);
  await c.ctx.close();
});

test('bannière « Abonnement requis » : absente avec accès donné par le coach, présente sinon', async () => {
  const a = await login('sd@test.local', PW);
  await thanks(a.pg);
  for (const t of ['Passer', 'Plus tard']) await a.click(t, 1500);
  await a.pg.waitForTimeout(500);
  assert.doesNotMatch(await a.pg.evaluate(() => document.body.innerText), /Abonnement requis|Débloquer Prime Athl/);
  await a.ctx.close();
  const f = await login('free@test.local', PW);
  for (const t of ['Merci', 'Passer', 'Plus tard']) await f.click(t, 1500);
  const body = await f.pg.evaluate(() => document.body.innerText);
  if (SHOT) await f.pg.screenshot({ path: `${SHOT}/banner-free.png` });
  assert.match(body, /Abonnement requis/, 'sans accès : la bannière reste');
  await f.ctx.close();
});
