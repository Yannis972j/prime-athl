// Tests d'authentification (signup / login / accès protégé).
// Black-box : on lance un vrai serveur isolé et on tape les vraies routes HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { if (srv) await srv.stop(); });

test('GET /api/health répond 200', async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`);
  assert.equal(r.status, 200);
});

test('signup refuse un body sans mot de passe', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: 'a@b.com' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'email_password_required');
});

test('signup refuse un mot de passe trop court', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: 'a@b.com', password: 'short' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'password_too_short');
});

test('signup refuse un email invalide', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: 'pas-un-email', password: 'longenough1' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_email');
});

test('signup d\'un athlète crée une demande en attente (pas de token)', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: 'athlete1@test.local', password: 'longenough1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.pending, true);
  assert.equal(r.body.token, undefined, 'un athlète en attente ne doit PAS recevoir de token');
});

test('signup refuse un email déjà utilisé (coach principal bootstrappé)', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: MAIN_COACH_EMAIL, password: 'longenough1' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'email_already_used');
});

test('login du coach principal renvoie un token et un profil coach actif', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token, 'un token doit être renvoyé');
  assert.equal(r.body.user.role, 'coach');
  assert.equal(r.body.user.isMainCoach, true);
});

test('login refuse un mauvais mot de passe', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: 'mauvais-mdp' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'invalid_credentials');
});

test('login refuse un utilisateur inconnu (anti-énumération, même erreur)', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'inconnu@test.local', password: 'peu-importe' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'invalid_credentials');
});

test('login refuse un athlète en attente d\'approbation', async () => {
  await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: 'pending2@test.local', password: 'longenough1' } });
  const r = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'pending2@test.local', password: 'longenough1' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'pending_approval');
});

test('GET /api/me sans token → 401', async () => {
  const r = await api(srv.baseUrl, 'GET', '/api/me');
  assert.equal(r.status, 401);
});

test('GET /api/me avec token valide → profil du coach', async () => {
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  const r = await api(srv.baseUrl, 'GET', '/api/me', { token: login.body.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.email, MAIN_COACH_EMAIL);
});

test('GET /api/me avec token bidon → 401', async () => {
  const r = await api(srv.baseUrl, 'GET', '/api/me', { token: 'pas.un.jwt' });
  assert.equal(r.status, 401);
});
