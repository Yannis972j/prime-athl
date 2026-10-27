// Pop-ups que reçoit un athlète à l'ouverture de l'app : accueil (1re connexion), rappel d'accès
// (J-3/J-2/J-1), relance d'inactivité. Vérifie qu'ils s'affichent au bon moment, une seule fois,
// et ne reviennent pas après fermeture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import webpush from 'web-push';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coachToken;
const PASSWORD = 'longenough1';

before(async () => {
  // Clés VAPID de test : sans elles le serveur n'a pas de notifications et l'invitation n'est pas proposée.
  const vapid = webpush.generateVAPIDKeys();
  srv = await startServer({ PORT: '3001', VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey });
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  coachToken = login.body.token;
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined, args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function newAthlete(email, extra = {}) {
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email, password: PASSWORD, firstName: 'Pop', lastName: 'Up' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  const id = la.body.user.id, token = la.body.token;
  // fullAccess = « accès complet » (déverrouille les univers). NB : il EXEMPTE aussi de la durée d'accès
  // (isAccessExpired) — les tests de rappel d'accès utilisent donc un athlète SANS accès complet.
  if (extra.full !== false) await api(srv.baseUrl, 'POST', `/api/access/grant/${id}`, { token: coachToken, body: { enabled: true } });
  if (extra.accessDays) await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${id}`, { token: coachToken, body: { accessDays: extra.accessDays } });
  if (extra.onboarded) await api(srv.baseUrl, 'POST', '/api/me/onboarded', { token });
  if (extra.sessionDaysAgo != null) {
    await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: { clientId: 'old' + email, name: 'LEGS', date: new Date(Date.now() - extra.sessionDaysAgo * 86400000).toISOString(), totalVolume: 100, exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5, done: true }] }] } });
  }
  return { id, token };
}
async function openApp(email, ctx) {
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(6000);
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email);
  await pg.fill('input[type=password]', PASSWORD);
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3800);
  pg.errs = errs;
  pg.text = () => pg.evaluate(() => document.body.innerText);
  return pg;
}
const click = async (pg, t) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 2500 }); await pg.waitForTimeout(700); return true; } catch { return false; } };
const mobile = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('pop-up d\'accueil : à la 1re connexion seulement, ne revient pas après « Passer »', async () => {
  await newAthlete('pop-new@test.local');
  const ctx = await mobile();
  let pg = await openApp('pop-new@test.local', ctx);
  assert.match(await pg.text(), /Bienvenue/);
  assert.equal(await click(pg, 'Passer'), true);
  assert.doesNotMatch(await pg.text(), /ÉTAPE 1/);
  await pg.reload(); await pg.waitForTimeout(3500);
  assert.doesNotMatch(await pg.text(), /ÉTAPE 1/, 'pas de 2e accueil après rechargement');
  assert.deepEqual(pg.errs, []);
  await ctx.close();
});

test('rappel d\'accès : pop-up « Plus que 2 jours d\'accès » à J-2, ne revient pas après « Plus tard »', async () => {
  await newAthlete('pop-acc@test.local', { accessDays: 2, onboarded: true, full: false });
  const ctx = await mobile();
  let pg = await openApp('pop-acc@test.local', ctx);
  assert.match(await pg.text(), /Plus que \d jours? d'accès/i);
  assert.match(await pg.text(), /Contacter mon coach/);
  assert.equal(await click(pg, 'Plus tard'), true);
  assert.doesNotMatch(await pg.text(), /Plus que \d jours? d'accès/i);
  await pg.reload(); await pg.waitForTimeout(3500);
  assert.doesNotMatch(await pg.text(), /Plus que \d jours? d'accès/i, 'une seule fois par palier');
  assert.deepEqual(pg.errs, []);
  await ctx.close();
});

test('rappel d\'accès : aucun pop-up pour un accès lointain (9 jours)', async () => {
  await newAthlete('pop-far@test.local', { accessDays: 9, onboarded: true, full: false });
  const ctx = await mobile();
  const pg = await openApp('pop-far@test.local', ctx);
  assert.doesNotMatch(await pg.text(), /d'accès/i);
  await ctx.close();
});

test('relance d\'inactivité : pop-up après 8 jours sans séance, jamais pour un athlète sans séance', async () => {
  await newAthlete('pop-idle@test.local', { onboarded: true, sessionDaysAgo: 8 });
  await newAthlete('pop-empty@test.local', { onboarded: true });
  const ctx = await mobile();
  const idle = await openApp('pop-idle@test.local', ctx);
  assert.match(await idle.text(), /\d+ jours sans séance/);
  assert.equal(await click(idle, 'Plus tard'), true);
  assert.doesNotMatch(await idle.text(), /jours sans séance/);
  await idle.reload(); await idle.waitForTimeout(3500);
  assert.doesNotMatch(await idle.text(), /jours sans séance/, 'pas de répétition immédiate');
  const ctx2 = await mobile();
  const empty = await openApp('pop-empty@test.local', ctx2);
  assert.doesNotMatch(await empty.text(), /sans séance/, 'un athlète sans aucune séance ne reçoit pas de relance');
  assert.deepEqual([...idle.errs, ...empty.errs], []);
  await ctx.close(); await ctx2.close();
});

test('invitation aux notifications : proposée à l\'athlète dans Séances, « Plus tard » la masque pour 7 jours', async () => {
  await newAthlete('pop-push@test.local', { onboarded: true });
  const ctx = await mobile();
  const pg = await openApp('pop-push@test.local', ctx);
  await click(pg, 'Coaching');
  // La carte apparaît après des appels asynchrones (service worker prêt, clé VAPID, abonnement) : sur un
  // runner CI lent, 1,5 s ne suffit pas → on attend l'apparition (jusqu'à 15 s) au lieu d'un délai fixe.
  await pg.waitForFunction(() => /Active les notifications/.test(document.body.innerText), null, { timeout: 15000 });
  assert.match(await pg.text(), /Active les notifications/);
  assert.match(await pg.text(), /Feedback de ton coach, nouvelle séance, fin de repos/);
  assert.equal(await click(pg, 'Plus tard'), true);
  assert.doesNotMatch(await pg.text(), /Active les notifications/);
  await pg.reload(); await pg.waitForTimeout(3500);
  await click(pg, 'Coaching'); await pg.waitForTimeout(1500);
  assert.doesNotMatch(await pg.text(), /Active les notifications/, 'mémorisé : pas de relance avant 7 jours');
  assert.deepEqual(pg.errs, []);
  await ctx.close();
});
