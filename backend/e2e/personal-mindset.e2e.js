// Citations perso : le coach les saisit dans la fiche d'Inaya ; SON récap les affiche, celui d'une autre athlète non.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';
import { SWIM_PHRASES } from '../personal-mindset.js';

let srv, browser, coachTok;
const PW = 'longenough1';
const set = (w, r) => ({ weight: w, reps: r, done: false, target: r, targetStr: String(r) });
const ex = (name, w, r) => ({ name, muscle: 'DOS', style: 'CLASSIQUE', restSeconds: 5, sets: [set(w, r), set(w, r)] });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coachTok = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function mkAthlete(email, first) {
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachTok, body: { email, password: PW, firstName: first, lastName: 'Test' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: PW } });
  const id = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${id}`, { token: coachTok, body: { enabled: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${id}`, { token: coachTok, body: { sessions: [{ id: 'n1', name: 'NATATION HAUT', sheetName: 'N', category: 'DOS', exercises: [ex('Tractions', 0, 8), ex('Rowing', 60, 10)] }] } });
  return id;
}
async function finishSession(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'NATATION HAUT', 'Commencer la séance', "C'est parti"]) await click(t, 1500);
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
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const mindset = await pg.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => /MINDSET/i.test(d.innerText || '') && d.querySelector('div[style*="italic"]') && d.children.length <= 3 && (d.innerText || '').length < 400); const q = el && el.querySelector('div[style*="italic"]'); return q ? q.innerText.replace(/^"|"$/g, '') : ''; });
  return { ctx, pg, mindset };
}

test('le coach saisit les citations dans la fiche d\'Inaya ; son récap les affiche ; celui d\'une autre athlète non', async () => {
  const inayaId = await mkAthlete('inaya@test.local', 'Inaya');
  await mkAthlete('laura@test.local', 'Laura');
  // 1 · le coach saisit les 10 citations dans l'app
  const cctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cp = await cctx.newPage(); cp.setDefaultTimeout(8000);
  const errs = []; cp.on('pageerror', e => errs.push(String(e)));
  await cp.goto(srv.baseUrl + '/Muscu.html');
  await cp.fill('input[type=email]', MAIN_COACH_EMAIL); await cp.fill('input[type=password]', MAIN_COACH_PASSWORD); await cp.keyboard.press('Enter');
  await cp.waitForTimeout(2500);
  try { await cp.getByText('Inaya', { exact: false }).first().click({ timeout: 3000 }); } catch {}
  await cp.waitForTimeout(800);
  const box = cp.getByTestId('coach-mindset-phrases');
  await box.waitFor();
  await box.locator('textarea').fill(SWIM_PHRASES.join('\n'));
  await box.getByTestId('coach-mindset-save').click();
  await cp.waitForTimeout(1500);
  await box.scrollIntoViewIfNeeded();
  if (process.env.SHOT_COACH) await cp.screenshot({ path: process.env.SHOT_COACH });
  const saved = await api(srv.baseUrl, 'GET', `/api/coach/athletes/${inayaId}`, { token: coachTok });
  assert.deepEqual(saved.body.mindsetPhrases, SWIM_PHRASES, 'les 10 citations sont enregistrées');
  assert.deepEqual(errs, []);
  await cctx.close();
  // 2 · son récap
  const a = await finishSession('inaya@test.local');
  assert.ok(SWIM_PHRASES.includes(a.mindset), 'Mindset d\'Inaya = une de ses citations : ' + a.mindset);
  if (process.env.SHOT_INAYA) { await a.pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Continuer'); if (b) b.scrollIntoView({ block: 'end' }); }); await a.pg.waitForTimeout(300); await a.pg.screenshot({ path: process.env.SHOT_INAYA }); }
  await a.ctx.close();
  // 3 · une autre athlète
  const b = await finishSession('laura@test.local');
  assert.ok(b.mindset && !SWIM_PHRASES.includes(b.mindset), 'Laura : phrase générique, jamais une citation de natation : ' + b.mindset);
  if (process.env.SHOT_LAURA) { await b.pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Continuer'); if (x) x.scrollIntoView({ block: 'end' }); }); await b.pg.waitForTimeout(300); await b.pg.screenshot({ path: process.env.SHOT_LAURA }); }
  await b.ctx.close();
});
