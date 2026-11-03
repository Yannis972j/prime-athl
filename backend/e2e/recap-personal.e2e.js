// Récap de fin de séance côté athlète : le bloc « Pour toi » reflète ce qui a été rempli dans
// « Mon profil coaching » (ici : réaction « Une statistique » + exercice préféré Rowing).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, athleteId, token, coach;
const EMAIL = 'e2e-recap@test.local', PASSWORD = 'longenough1';
const set = (w, r) => ({ weight: w, reps: r, done: false, target: r, targetStr: String(r) });
const ex = (name, w, r) => ({ name, muscle: 'DOS', style: 'CLASSIQUE', restSeconds: 5, sets: [set(w, r), set(w, r)] });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PASSWORD, firstName: 'Laura', lastName: 'Recap' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  token = la.body.token; athleteId = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coach, body: { enabled: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${athleteId}`, { token: coach, body: { sessions: [{ id: 'r1', name: 'E2E PULL', sheetName: 'E2E', category: 'DOS', exercises: [ex('Tractions', 0, 8), ex('Rowing', 60, 10)] }] } });
  // séance précédente plus légère → la séance du jour est en hausse
  const d = new Date(Date.now() - 7 * 86400000).toISOString();
  await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body: { name: 'E2E PULL', date: d, totalVolume: 800,
    exercises: [{ name: 'Tractions', muscle: 'DOS', sets: [{ weight: 0, reps: 6, done: true }] }, { name: 'Rowing', muscle: 'DOS', sets: [{ weight: 40, reps: 10, done: true }, { weight: 40, reps: 10, done: true }] }] } });
  await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { cpSuccessReaction: ['Une statistique'], cpFavExercise: 'Rowing', cpNickname: 'Lau' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('récap athlète : « Pour toi » = ce qui a été rempli dans le profil coaching', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL);
  await pg.fill('input[type=password]', PASSWORD);
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async t => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 3000 }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'E2E PULL', 'Commencer la séance', "C'est parti"]) await click(t);
  let idle = 0;
  for (let g = 0; g < 120 && idle < 8; g++) {
    const r = await pg.evaluate(() => {
      const ok = [...document.querySelectorAll('button')].find(b => b.style.width === '38px' && b.style.height === '38px' && b.parentElement.querySelector('button[style*="26px"]'));
      if (ok) { ok.click(); return 'set'; }
      const nx = [...document.querySelectorAll('button')].find(b => /^Suivant/.test(b.innerText.trim()) && !b.disabled);
      if (nx) { nx.click(); return 'next'; }
      return 'end';
    });
    idle = r === 'end' ? idle + 1 : 0;
    await pg.waitForTimeout(r === 'set' ? 350 : r === 'end' ? 1000 : 500);
  }
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (b) b.click(); });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); }); // RPE : passer
  await pg.waitForTimeout(3500);
  const txt = await pg.evaluate(() => document.body.innerText);
  await pg.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.innerText && /^🎯\s*pour toi/i.test(d.innerText.trim()) && d.children.length >= 2); if (el) el.scrollIntoView({ block: 'center' }); });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.env.SHOT || '/tmp/recap.png' });
  assert.match(txt, /pour toi/i);
  assert.match(txt, /En chiffres : \+\d+ % de volume/);
  assert.match(txt, /Au programme aujourd'hui : Rowing, ton exercice préféré/);
  assert.deepEqual(errs, []);
  await ctx.close();
});
