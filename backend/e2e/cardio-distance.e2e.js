// Cardio SKIERG : la distance réalisée se saisit comme poids/reps, avec le repère « dernière fois »,
// est enregistrée et comparée dans le récap (↑ +50 m). Testé en mode liste ET en mode focus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, athleteId, token;
const EMAIL = 'e2e-dist@test.local', PASSWORD = 'longenough1';
const skierg = { name: 'SKIERG', muscle: 'CARDIO', style: 'CARDIO', restSeconds: 60, cardio: { distance: '', vitesse: '', inclinaison: '', duree: "5'" }, sets: [{ weight: 0, reps: 0, done: false }] };

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PASSWORD, firstName: 'Karim', lastName: 'Dist' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  token = la.body.token; athleteId = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coach, body: { enabled: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${athleteId}`, { token: coach, body: { sessions: [{ id: 'sk1', name: 'CARDIO SKIERG', sheetName: 'T', category: 'CARDIO', exercises: [skierg] }] } });
  await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body: { name: 'CARDIO SKIERG', date: new Date(Date.now() - 7 * 86400000).toISOString(),
    exercises: [{ name: 'SKIERG', muscle: 'CARDIO', style: 'CARDIO', groupType: 'cardio', cardio: { duree: "5'" }, sets: [{ weight: 0, reps: 0, distance: 1200 }] }] } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function run(focus, shotPrefix, lastM = '1[\\s\\u00a0\\u202f]200', typed = '1250', prevM = '1[\\s\\u00a0\\u202f]200', curM = '1[\\s\\u00a0\\u202f]250') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (focus) await ctx.addInitScript(() => { try { localStorage.setItem('pa_focus_mode', '1'); } catch {} });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'CARDIO SKIERG', 'Commencer la séance', "C'est parti"]) await click(t, 1500);
  await pg.waitForTimeout(800);
  const card = pg.getByTestId('cardio-distance');
  await card.waitFor();
  let t = await card.innerText();
  assert.match(t, /DISTANCE RÉALISÉE/i);
  assert.match(t, new RegExp('Dernière fois\\s*:?\\s*' + lastM + ' m', 'i'));
  assert.match(t, /Note ta distance/i);
  if (shotPrefix) await pg.screenshot({ path: `${shotPrefix}-avant.png` });
  await card.locator('input').fill(typed);
  await pg.waitForTimeout(300);
  t = await card.innerText();
  assert.match(t, /↑ \+50 m vs la dernière fois/);
  if (shotPrefix) await pg.screenshot({ path: `${shotPrefix}-saisie.png` });
  // terminer le cardio, puis la séance
  const done = await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /Marquer comme terminé|✓ FAIT/.test(b.innerText)); if (b) { b.click(); return true; } return false; });
  if (!done) await click('Marquer comme terminé', 1500);
  await pg.waitForTimeout(600);
  for (let g = 0; g < 8; g++) {
    const r = await pg.evaluate(() => { const nx = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (nx) { nx.click(); return 'fin'; } const s = [...document.querySelectorAll('button')].find(b => /^Suivant/.test(b.innerText.trim()) && !b.disabled); if (s) { s.click(); return 'next'; } return 'none'; });
    await pg.waitForTimeout(700);
    if (r === 'fin') break;
  }
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const txt = await pg.evaluate(() => document.body.innerText);
  if (shotPrefix) { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.screenshot({ path: `${shotPrefix}-recap.png` }); }
  assert.match(txt, new RegExp('Distance\\s*:\\s*' + prevM + ' m\\s*→\\s*' + curM + ' m\\s*\\(\\+50\\)'));
  assert.match(txt, new RegExp('Nouveau record de distance sur SKIERG, Karim\\. ' + curM + ' m'), 'message de félicitation propre au cardio (pas « 0kg »)');
  assert.doesNotMatch(txt, /\b0kg\b/);
  assert.deepEqual(errs, []);
  await ctx.close();
}

test('SKIERG (mode liste) : saisie de la distance, repère dernière fois, récap « 1 200 m → 1 250 m (+50) »', async () => {
  await run(false, process.env.SHOT_LIST);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  const s = list.body.filter(x => x.name === 'CARDIO SKIERG').sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  assert.equal(s.exercises[0].sets[0].distance, 1250, 'distance enregistrée côté serveur');
});

test('SKIERG (mode focus) : même carte, même enregistrement', async () => {
  await run(true, process.env.SHOT_FOCUS, '1[\\s\\u00a0\\u202f]250', '1300', '1[\\s\\u00a0\\u202f]250', '1[\\s\\u00a0\\u202f]300');
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  const d = list.body.filter(x => x.name === 'CARDIO SKIERG').map(x => x.exercises[0].sets[0].distance).sort((a, b) => a - b);
  assert.deepEqual(d, [1200, 1250, 1300], 'les trois séances gardent leur distance');
});

test('SKIERG en séries : « + Ajouter une série » puis 3 distances (400 / 380 / 420), somme comparée dans le récap', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'CARDIO SKIERG', 'Commencer la séance', "C'est parti"]) await click(t, 1500);
  const card = pg.getByTestId('cardio-distance');
  await card.waitFor();
  assert.equal(await card.locator('input').count(), 1, 'une seule série au départ');
  await pg.getByTestId('cardio-add-set').click();
  await pg.getByTestId('cardio-add-set').click();
  assert.equal(await card.locator('input').count(), 3, 'trois champs de distance');
  assert.match(await card.innerText(), /S1[\s\S]*S2[\s\S]*S3/);
  const r3 = card.getByTestId('cardio-set-row');
  assert.match(await r3.nth(0).innerText(), /Dernière fois\s*:?\s*1[\s\u00a0\u202f]300 m/i);
  assert.match(await r3.nth(1).innerText(), /Dernière fois\s*:?\s*—/i, 'pas de référence pour une série qui n\'existait pas');
  for (let i = 0; i < 3; i++) await card.locator('input').nth(i).fill(['400', '380', '420'][i]);
  assert.doesNotMatch(await r3.nth(0).innerText(), /[+−-]\s?\d/, 'pas d\'écart par série : le nombre de séries a changé');
  assert.match(await pg.getByTestId('cardio-cumul').innerText(), /1[\s\u00a0\u202f]200 m/);
  const vals = ['400', '380', '420'];
  for (let i = 0; i < 3; i++) await card.locator('input').nth(i).fill(vals[i]);
  await pg.waitForTimeout(300);
  const t = await card.innerText();
  assert.match(t, /Total 1[\s\u00a0\u202f]200 m · pas de comparaison/, 'séries différentes de la dernière fois : pas de faux écart');
  if (process.env.SHOT_SERIES) await pg.screenshot({ path: `${process.env.SHOT_SERIES}-saisie.png` });
  await pg.getByTestId('cardio-del-set').click();
  assert.equal(await card.locator('input').count(), 2, 'retirer la dernière série');
  await pg.getByTestId('cardio-add-set').click();
  assert.equal(await card.locator('input').nth(2).inputValue(), '', 'la série ré-ajoutée est vide');
  await card.locator('input').nth(2).fill('420');
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /Marquer comme terminé/.test(b.innerText)); if (b) b.click(); });
  await pg.waitForTimeout(600);
  for (let g = 0; g < 8; g++) {
    const r = await pg.evaluate(() => { const nx = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (nx) { nx.click(); return 'fin'; } return 'none'; });
    await pg.waitForTimeout(700); if (r === 'fin') break;
  }
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const txt = await pg.evaluate(() => document.body.innerText);
  if (process.env.SHOT_SERIES) await pg.screenshot({ path: `${process.env.SHOT_SERIES}-recap.png` });
  assert.match(txt, /Distance\s*:\s*1[\s\u00a0\u202f]300 m\s*→\s*1[\s\u00a0\u202f]200 m\s*\(séries différentes\)/, 'totaux montrés sans jugement : 1 série contre 3');
  assert.doesNotMatch(txt, /Séance en baisse|Reprends-toi/, 'pas de faux « séance en baisse »');
  assert.match(txt, /1\s*→\s*3\s*séries/);
  assert.deepEqual(errs, []);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  const s = list.body.filter(x => x.name === 'CARDIO SKIERG').sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  assert.deepEqual(s.exercises[0].sets.map(x => x.distance), [400, 380, 420]);
  await ctx.close();
});

test('SKIERG en séries, 3 séries comme la dernière fois : repère par série, écart en direct, récap ↑ + record', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'CARDIO SKIERG', 'Commencer la séance', "C'est parti"]) await click(t, 1500);
  const card = pg.getByTestId('cardio-distance');
  await card.waitFor();
  await pg.getByTestId('cardio-add-set').click(); await pg.getByTestId('cardio-add-set').click();
  const ph = await card.locator('input').evaluateAll(els => els.map(e => e.placeholder));
  assert.deepEqual(ph, ['400', '380', '420'], 'repère de la dernière fois, série par série');
  if (process.env.SHOT_SAME) await pg.screenshot({ path: `${process.env.SHOT_SAME}-avant.png` });
  const vals = ['420', '400', '430'];
  for (let i = 0; i < 3; i++) await card.locator('input').nth(i).fill(vals[i]);
  await pg.waitForTimeout(300);
  assert.match(await card.innerText(), /↑ \+50 m vs la dernière fois/);
  const rows = card.getByTestId('cardio-set-row');
  const rt = i => rows.nth(i).innerText();
  assert.match(await rt(0), /Dernière fois\s*:?\s*400 m\s*\+20/i); assert.match(await rt(0), /Cumul\s*:\s*420 m/);
  assert.match(await rt(1), /Dernière fois\s*:?\s*380 m\s*\+20/i); assert.match(await rt(1), /Cumul\s*:\s*820 m/);
  assert.match(await rt(2), /Dernière fois\s*:?\s*420 m\s*\+10/i); assert.match(await rt(2), /Cumul\s*:\s*1[\s\u00a0\u202f]250 m/);
  const cumul = await pg.getByTestId('cardio-cumul').innerText();
  assert.match(cumul, /CUMUL/i); assert.match(cumul, /1[\s\u00a0\u202f]250 m/); assert.match(cumul, /Dernière fois\s*:?\s*1[\s\u00a0\u202f]200 m/i);
  if (process.env.SHOT_SAME) await pg.screenshot({ path: `${process.env.SHOT_SAME}-saisie.png` });
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /Marquer comme terminé/.test(b.innerText)); if (b) b.click(); });
  await pg.waitForTimeout(600);
  for (let g = 0; g < 8; g++) {
    const r = await pg.evaluate(() => { const nx = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (nx) { nx.click(); return 'fin'; } return 'none'; });
    await pg.waitForTimeout(700); if (r === 'fin') break;
  }
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const txt = await pg.evaluate(() => document.body.innerText);
  if (process.env.SHOT_SAME) await pg.screenshot({ path: `${process.env.SHOT_SAME}-recap.png` });
  assert.match(txt, /Distance\s*:\s*1[\s  ]200 m\s*→\s*1[\s  ]250 m\s*\(\+50\)/);
  assert.match(txt, /Nouveau record de distance sur SKIERG/);
  assert.deepEqual(errs, []);
  await ctx.close();
});
