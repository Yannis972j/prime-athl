// Accès expiré : l'athlète garde le Catalogue + la messagerie (+ profil) ; Coaching / IA / Explorer / Stats
// sont bloqués (écran « Accès expiré »), même avec l'accès complet et les 4 univers cochés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const db = path.join(os.tmpdir(), `pa-exp-e2e-${crypto.randomUUID()}.json`);

before(async () => {
  // 1er démarrage : création de l'athlète (accès complet + 4 univers) ; arrêt ; on pose une date de fin
  // DÉPASSÉE dans la base ; 2e démarrage (= redémarrage du serveur).
  let s = await startServer({ PORT: '3001', DB_PATH: db });
  const coach = (await api(s.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(s.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'ex@test.local', password: PW, firstName: 'Laura', lastName: 'Ex' } });
  const id = (await api(s.baseUrl, 'POST', '/api/auth/login', { body: { email: 'ex@test.local', password: PW } })).body.user.id;
  await api(s.baseUrl, 'POST', `/api/access/grant/${id}`, { token: coach, body: { enabled: true } });
  await api(s.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  await new Promise(r => setTimeout(r, 900)); // flush (debounce) avant l'arrêt
  await s.stop();
  const data = JSON.parse(fs.readFileSync(db, 'utf8'));
  Object.values(data.users).find(u => u.email === 'ex@test.local').accessExpiresAt = new Date(Date.now() - 2 * 86400000).toISOString();
  fs.writeFileSync(db, JSON.stringify(data));
  srv = await startServer({ PORT: '3001', DB_PATH: db });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('athlète expiré : Catalogue + messagerie ouverts, Coaching/IA/Explorer/Stats bloqués', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', 'ex@test.local'); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  await pg.getByText('Passer', { exact: true }).first().click({ timeout: 1500 }).catch(() => {});
  await pg.waitForTimeout(600);
  const overlay = pg.getByText('Ton accès est arrivé à son terme', { exact: false });
  const tab = re => pg.getByText(re).last();

  // 1) Univers : bannière « accès terminé », Catalogue ouvert, les 3 autres verrouillés ; pas d'écran de blocage
  await pg.getByTestId('expired-banner').waitFor();
  assert.equal(await overlay.count(), 0, 'pas d\'écran de blocage sur l\'écran des univers');
  assert.match(await pg.getByTestId('universe-coach').innerText(), /Accès terminé/);
  assert.match(await pg.getByTestId('universe-ia').innerText(), /Accès terminé/);
  assert.match(await pg.getByTestId('universe-explorer').innerText(), /Accès terminé/);
  assert.doesNotMatch(await pg.getByTestId('universe-programmes').innerText(), /Accès terminé/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/ae-1-univers.png` });

  // 2) toucher un univers verrouillé → messagerie (pas d'accès au contenu)
  await pg.getByTestId('universe-coach').click(); await pg.waitForTimeout(1000);
  assert.match(await pg.evaluate(() => document.body.innerText), /Messages/);
  assert.equal(await overlay.count(), 0);

  // 3) messagerie : le coach est bien retrouvé (/api/my-coach autorisé)
  assert.doesNotMatch(await pg.evaluate(() => document.body.innerText), /Aucun coach assign/);
  assert.match(await pg.evaluate(() => document.body.innerText), /Yannis/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/ae-2-messages.png` });

  // 4) Catalogue : accessible
  await tab(/^univers$/i).click(); await pg.waitForTimeout(800);
  await pg.getByTestId('universe-programmes').click(); await pg.waitForTimeout(1200);
  assert.match(await pg.evaluate(() => document.body.innerText), /Catalogue de programmes/);
  assert.equal(await overlay.count(), 0, 'le Catalogue n\'est pas bloqué');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/ae-3-catalogue.png` });

  // 5) Stats : bloqué (écran « Accès expiré »), avec un accès direct au Catalogue et à la messagerie
  await tab(/^stats$/i).click(); await pg.waitForTimeout(900);
  await overlay.first().waitFor();
  await pg.getByTestId('expired-catalogue').waitFor();
  if (SHOT) await pg.screenshot({ path: `${SHOT}/ae-4-stats-bloque.png` });
  await pg.getByTestId('expired-catalogue').click(); await pg.waitForTimeout(1000);
  assert.equal(await overlay.count(), 0);
  assert.match(await pg.evaluate(() => document.body.innerText), /Catalogue de programmes/);

  // 6) le serveur refuse bien le contenu des univers bloqués (pas seulement masqué)
  const t = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'ex@test.local', password: PW } })).body.token;
  assert.equal((await api(srv.baseUrl, 'GET', '/api/program', { token: t })).status, 403);
  assert.equal((await api(srv.baseUrl, 'POST', '/api/ai/generate-program', { token: t, body: { level: 'x', goal: 'x', days: 3, equipment: 'x' } })).status, 403);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('athlète expiré : il peut suivre un programme du Catalogue (la séance est enregistrée)', async () => {
  const L = async (email, password) => (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password } })).body.token;
  const coach = await L(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD), ath = await L('ex@test.local', PW);
  const set = { weight: 20, reps: 0, done: false, target: 5, targetStr: '5' };
  const prog = (await api(srv.baseUrl, 'POST', '/api/admin/training-programs', { token: coach, body: {
    name: 'Programme Test Catalogue', price: 0, category: 'fullbody',
    weeks: [{ title: 'Semaine 1', sessions: [{ name: 'Séance Catalogue 1', exercises: [{ name: 'Squat', muscle: 'JAMBES', sets: [set, set] }] }] }],
  } })).body;
  await api(srv.baseUrl, 'PUT', `/api/admin/training-programs/${prog.id}`, { token: coach, body: { published: true } });
  const buy = await api(srv.baseUrl, 'POST', `/api/training-programs/${prog.id}/purchase`, { token: ath });
  assert.equal(buy.status, 200, 'achat/obtention d\'un programme gratuit autorisé après expiration');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  const saves = []; pg.on('response', r => { if (r.request().method() === 'POST' && /\/api\/sessions$/.test(r.url())) saves.push(r.status()); });
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', 'ex@test.local'); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async t => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 3000 }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Passer');
  await pg.getByTestId('universe-programmes').click(); await pg.waitForTimeout(1200);
  assert.ok(await click('Mes programmes') || await click('Mes Programmes'), 'onglet « Mes programmes »');
  assert.ok(await click('Programme Test Catalogue'), 'ouvrir le programme acheté');
  assert.ok(await click('Lancer'), 'lancer la séance du programme');
  await click('Commencer la séance'); await click("C'est parti");
  for (let g = 0; g < 40; g++) {
    const r = await pg.evaluate(() => {
      const ok = [...document.querySelectorAll('button')].find(b => b.style.width === '38px' && b.style.height === '38px' && b.parentElement.querySelector('button[style*="26px"]'));
      if (ok) { ok.click(); return 'set'; }
      const nx = [...document.querySelectorAll('button')].find(b => /^Suivant/.test(b.innerText.trim()) && !b.disabled);
      if (nx) { nx.click(); return 'next'; }
      return 'end';
    });
    await pg.waitForTimeout(r === 'set' ? 350 : 500);
    if (r === 'end') break;
  }
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /(Terminer|Valider) la séance/.test(b.innerText)); if (b) b.click(); });
  await pg.waitForTimeout(1500);
  await click('Passer'); // RPE (« Comment tu te sens ? »)
  await pg.waitForTimeout(2500);
  assert.ok(saves.length >= 1, 'la séance du Catalogue est envoyée au serveur');
  assert.ok(saves.every(s => s === 200), 'toutes acceptées par le serveur (reçu ' + saves.join(',') + ')');
  assert.deepEqual(errs, []);
  await ctx.close();
});
