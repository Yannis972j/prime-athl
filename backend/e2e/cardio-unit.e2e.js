// Distance cardio en m OU km : saisie « 2,5 » km = 2 500 m stockés ; choix retenu par exercice ; SKIERG reste en m par défaut.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, token;
const EMAIL = 'unit@test.local', PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const cardioEx = (name, sets) => ({ name, muscle: 'CARDIO', style: 'CARDIO', groupType: 'cardio', cardio: { duree: "30'", vitesse: '4.0-4.8', inclinaison: '9-11%' }, sets });

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PW, firstName: 'Yann', lastName: 'Unit' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PW } });
  token = la.body.token;
  const id = la.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${id}`, { token: coach, body: { sessions: [{ id: 'u1', name: 'PULL CARDIO', sheetName: 'T', category: 'CARDIO', exercises: [cardioEx('Tapis de course', [{ weight: 0, reps: 0, done: false }]), cardioEx('SKIERG', [{ weight: 0, reps: 0, done: false }])] }] } });
  await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, { token: coach, body: { name: 'PULL CARDIO', date: new Date(Date.now() - 7 * 86400000).toISOString(), exercises: [cardioEx('Tapis de course', [{ weight: 0, reps: 0, distance: 3000 }]), cardioEx('SKIERG', [{ weight: 0, reps: 0, distance: 1200 }])] } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('tapis : km par défaut, « 2,5 » = 2 500 m ; bascule en m ; SKIERG en m ; choix retenu', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 1500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Merci', 'Passer', 'Plus tard', 'Coaching', 'Biblio', 'PULL CARDIO', 'Commencer la séance', "C'est parti"]) await click(t);
  const card = pg.getByTestId('cardio-distance');
  await card.waitFor();
  // 1) tapis : km par défaut, repère « dernière fois » en km
  assert.equal(await pg.getByTestId('cardio-unit-km').getAttribute('aria-pressed'), 'true');
  assert.match(await card.innerText(), /3[\s ]km/);
  assert.equal(await card.locator('input').getAttribute('placeholder'), '3');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/unit-1-km.png` });
  await card.locator('input').fill('2,5'); await pg.waitForTimeout(300);
  assert.equal(await card.locator('input').inputValue(), '2,5');
  assert.match(await card.innerText(), /↓ 0,5[\s ]km vs la dernière fois/);
  // 2) bascule en m : même distance, en mètres (2 500 stockés)
  await pg.getByTestId('cardio-unit-m').click(); await pg.waitForTimeout(300);
  assert.equal(await card.locator('input').inputValue(), '2500');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/unit-2-m.png` });
  await card.locator('input').fill('2800'); await pg.waitForTimeout(200);
  await pg.getByTestId('cardio-unit-km').click(); await pg.waitForTimeout(300);
  assert.equal(await card.locator('input').inputValue(), '2,8');
  // 3) un séparateur point est accepté, plafonné à 3 décimales
  await card.locator('input').fill('4.1234'); await pg.waitForTimeout(200);
  assert.equal(await card.locator('input').inputValue(), '4,123');
  await card.locator('input').fill('2,5'); await pg.waitForTimeout(200);
  // le choix est retenu après rechargement
  await pg.getByTestId('cardio-unit-m').click(); await pg.waitForTimeout(200);
  assert.equal(await pg.evaluate(() => localStorage.getItem('pa_dist_unit:tapis de course')), 'm');
  await pg.getByTestId('cardio-unit-km').click(); await pg.waitForTimeout(200);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('enregistrement : la distance saisie en km est stockée en mètres', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 1500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Merci', 'Passer', 'Plus tard', 'Coaching', 'Biblio', 'PULL CARDIO', 'Commencer la séance', "C'est parti"]) await click(t);
  await pg.getByTestId('cardio-distance').locator('input').fill('2,5'); await pg.waitForTimeout(300);
  for (let g = 0; g < 12; g++) {
    const r = await pg.evaluate(() => {
      const done = [...document.querySelectorAll('button')].find(b => /Marquer comme terminé|✓ FAIT/.test(b.innerText)); if (done) { done.click(); return 'done'; }
      const fin = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (fin) { fin.click(); return 'fin'; }
      const nx = [...document.querySelectorAll('button')].find(b => /^Suivant/.test(b.innerText.trim()) && !b.disabled); if (nx) { nx.click(); return 'next'; }
      return 'none';
    });
    await pg.waitForTimeout(900);
    if (r === 'fin') break;
  }
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3000);
  const list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token })).body;
  const mine = list.filter(s => /PULL CARDIO/.test(s.name)).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const tapis = mine.exercises.find(e => /tapis/i.test(e.name));
  assert.equal(tapis.sets[0].distance, 2500, 'stocké en mètres : ' + JSON.stringify(tapis.sets));
  await ctx.close();
});
