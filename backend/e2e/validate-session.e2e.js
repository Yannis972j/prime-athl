// Test de bout en bout (vrai navigateur) : un athlète démarre une séance, valide ses séries et la
// termine. C'est le parcours le plus critique de l'app — un bug ici (ex: ReferenceError à la
// validation) empêche TOUS les athlètes de s'entraîner, et les tests unitaires/regex ne le voient pas.
//
// Lancé par `npm run e2e` et dans la CI. Hors CI, utilise le Chromium de E2E_CHROMIUM si défini
// (sinon le navigateur géré par playwright-core).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, athleteId, athleteToken, coachToken;
const EMAIL = 'e2e-athlete@test.local', PASSWORD = 'longenough1';

before(async () => {
  // Port 3001 : c'est là que le frontend cherche son backend (cf. API_BASE dans Muscu.html).
  srv = await startServer({ PORT: '3001' });
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  coachToken = login.body.token;
  const created = await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email: EMAIL, password: PASSWORD, firstName: 'E2E', lastName: 'Athlete' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  athleteToken = la.body.token;
  athleteId = la.body.user?.id || created.body?.id || created.body?.athlete?.id;
  // Accès complet (sinon l'univers Coaching est verrouillé « Plan requis »).
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coachToken, body: { enabled: true } });
  // Une séance « Bibliothèque » à démarrer : 2 exercices, séries préremplies.
  const set = (w, r) => ({ weight: w, reps: r, done: false, target: r, targetStr: String(r) });
  await api(srv.baseUrl, 'PUT', `/api/coach/session-library/${athleteId}`, {
    token: coachToken,
    body: { sessions: [{ id: 'e2e1', name: 'E2E PULL', sheetName: 'E2E', category: 'DOS', exercises: [
      { name: 'Tractions', muscle: 'DOS', style: 'CLASSIQUE', restSeconds: 5, sets: [set(0, 8), set(0, 8)] },
      { name: 'Rowing', muscle: 'DOS', style: 'CLASSIQUE', restSeconds: 5, sets: [set(60, 10), set(60, 10)] },
    ] }] },
  });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('e2e : démarrer → valider les séries → terminer une séance l\'enregistre, sans aucune erreur JS', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  const jsErrors = [];
  pg.on('pageerror', e => jsErrors.push(String(e)));
  const posts = [];
  pg.on('request', r => { if (r.method() === 'POST' && /\/api\/sessions$/.test(r.url())) posts.push(r.url()); });

  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL);
  await pg.fill('input[type=password]', PASSWORD);
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async t => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 3000 }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  // 'Passer' = tour d'accueil du nouvel athlète ; 'Plus tard' = pop-up d'inactivité éventuelle
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'E2E', 'E2E PULL', 'Commencer la séance', "C'est parti"]) await click(t);

  // valide toutes les séries (bouton ✓), enchaîne les exercices
  for (let g = 0; g < 60; g++) {
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
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer'); if (b) b.click(); });
  await pg.waitForTimeout(3500);

  assert.deepEqual(jsErrors, [], 'aucune erreur JS pendant le parcours');
  assert.equal(posts.length, 1, 'la séance validée est envoyée au serveur (1 seul POST /api/sessions)');
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken });
  assert.equal(list.body.length, 1, 'la séance est enregistrée côté serveur');
  assert.equal(list.body[0].name, 'E2E PULL');
  assert.ok(list.body[0].clientId === undefined || typeof list.body[0].clientId === 'string');
  await ctx.close();
});

test('e2e : parcours des onglets athlète puis coach sans erreur JS', async () => {
  const run = async (email, password, tabs) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(5000);
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e)));
    await pg.goto(srv.baseUrl + '/Muscu.html');
    await pg.fill('input[type=email]', email);
    await pg.fill('input[type=password]', password);
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(3000);
    for (const t of ['Passer', 'Plus tard', ...tabs]) { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 2000 }); await pg.waitForTimeout(600); } catch { /* onglet absent : ignoré */ } }
    await ctx.close();
    return errs;
  };
  assert.deepEqual(await run(EMAIL, PASSWORD, ['Coaching', 'Séances', 'Biblio', 'Nutrition', 'STATS', 'PROFIL', 'CHAT']), [], 'athlète : aucune erreur JS');
  assert.deepEqual(await run(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD, ['COACH', 'STATS', 'PROFIL', 'CHAT']), [], 'coach : aucune erreur JS');
});

test('e2e : la sonnerie sonne à la fin NATURELLE du repos (+ message à l\'écran), mais pas quand on « passe le repos »', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Compte les lectures audibles de la sonnerie (<audio> non muet) ; la lecture muette de déblocage est ignorée.
  await ctx.addInitScript(() => {
    window.__rings = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted) window.__rings++;
      return orig.apply(this, arguments);
    };
  });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  const jsErrors = [];
  pg.on('pageerror', e => jsErrors.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL);
  await pg.fill('input[type=password]', PASSWORD);
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async t => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 3000 }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Biblio', 'E2E', 'E2E PULL', 'Commencer la séance', "C'est parti"]) await click(t);
  const validateSet = () => pg.evaluate(() => {
    const ok = [...document.querySelectorAll('button')].find(b => b.style.width === '38px' && b.style.height === '38px' && b.parentElement.querySelector('button[style*="26px"]'));
    if (ok) { ok.click(); return true; }
    return false;
  });
  const rings = () => pg.evaluate(() => window.__rings);

  // 1) fin naturelle : valider une série → repos de 5 s → la sonnerie doit jouer
  assert.equal(await validateSet(), true, 'série validée');
  await pg.waitForTimeout(1000);
  assert.equal(await rings(), 0, 'pas de sonnerie pendant le repos');
  await pg.waitForTimeout(6000);
  assert.ok((await rings()) >= 1, 'sonnerie jouée à la fin du repos');
  assert.doesNotMatch(await pg.evaluate(() => document.body.innerText), /c'est reparti/, 'pas de toast en doublon');
  const afterNatural = await rings();

  // 2) repos passé volontairement : aucune sonnerie
  assert.equal(await validateSet(), true, '2e série validée');
  await pg.waitForTimeout(800);
  await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Passer le repos' || b.title === 'Passer le repos'); if (b) b.click(); });
  await pg.waitForTimeout(1500);
  assert.equal(await rings(), afterNatural, 'pas de sonnerie quand on passe le repos');
  assert.deepEqual(jsErrors, []);
  await ctx.close();
});
