// Hors ligne : une fois l'appli visitée (service worker installé), elle s'OUVRE sans réseau — plus de page
// « Hors ligne — reconnecte-toi » — et la version en ligne reste toujours la plus récente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser;
const EMAIL = 'e2e-offline@test.local', PW = 'longenough1';

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PW, firstName: 'Off', lastName: 'Line' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('hors ligne : l\'appli s\'ouvre (cache du service worker) en restant connectée, avec un bandeau « Hors ligne »', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'allow' });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(10000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(2500);
  // service worker prêt + page contrôlée par lui + appli présente dans son cache
  await pg.evaluate(() => navigator.serviceWorker.ready);
  await pg.reload(); await pg.waitForTimeout(1500);
  const cached = await pg.evaluate(async () => { const ks = await caches.keys(); for (const k of ks) { if (await (await caches.open(k)).match('/Muscu.html')) return k; } return null; });
  assert.match(cached || '', /prime-athl-v14/, 'Muscu.html gardé dans le cache du service worker');
  assert.equal(await pg.evaluate(() => !!navigator.serviceWorker.controller), true, 'page contrôlée par le service worker');

  await ctx.setOffline(true);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3000);
  const txt = await pg.evaluate(() => document.body.innerText);
  assert.doesNotMatch(txt, /Hors ligne — reconnecte-toi pour accéder/, 'plus de page morte hors ligne');
  assert.doesNotMatch(txt, /Se connecter|Mot de passe oublié/, 'toujours connecté : pas l\'écran de connexion');
  await pg.getByTestId('offline-banner').waitFor();
  assert.ok(/UNIVERS|PROFIL|STATS/i.test(txt), 'la navigation de l\'appli est affichée : « ' + txt.slice(0, 100).replace(/\n/g, ' ') + ' »');
  if (process.env.SHOT) await pg.screenshot({ path: process.env.SHOT });
  // retour du réseau : la bannière disparaît
  await ctx.setOffline(false);
  await pg.waitForTimeout(1200);
  assert.equal(await pg.getByTestId('offline-banner').count(), 0, 'bannière retirée au retour du réseau');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('en ligne : toujours la dernière version (réseau d\'abord)', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(10000);
  await pg.goto(srv.baseUrl + '/Muscu.html'); await pg.evaluate(() => navigator.serviceWorker.ready);
  await pg.reload(); await pg.waitForTimeout(800);
  // la réponse servie à la page vient du réseau (en-tête no-cache du serveur), pas d'une copie figée
  const [resp] = await Promise.all([pg.waitForResponse(r => r.url().endsWith('/Muscu.html')), pg.reload()]);
  assert.equal(resp.status(), 200);
  assert.match(resp.headers()['cache-control'] || '', /no-cache/);
  await ctx.close();
});

test('session refusée (401) : retour à la connexion et profil mis en cache effacé ; erreur serveur (503) : on reste dans l\'appli', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(10000);
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(2500);
  assert.ok(await pg.evaluate(() => !!localStorage.getItem('pa_me_cache')), 'profil gardé après connexion');
  // serveur qui se réveille : /api/me répond 503 → l'appli s'ouvre quand même
  await pg.route('**/api/me', r => r.request().method() === 'GET' ? r.fulfill({ status: 503, body: 'wake up' }) : r.continue());
  await pg.reload(); await pg.waitForTimeout(2500);
  assert.doesNotMatch(await pg.evaluate(() => document.body.innerText), /Se connecter/, '503 : toujours dans l\'appli');
  // session réellement refusée → connexion + cache effacé
  await pg.unroute('**/api/me');
  await pg.route('**/api/me', r => r.request().method() === 'GET' ? r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }) : r.continue());
  await pg.reload(); await pg.waitForTimeout(2500);
  assert.match(await pg.evaluate(() => document.body.innerText), /Se connecter/, '401 : écran de connexion');
  assert.equal(await pg.evaluate(() => localStorage.getItem('pa_me_cache')), null, 'profil effacé');
  await ctx.close();
});
