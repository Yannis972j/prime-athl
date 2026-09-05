// Tests d'autorisation de la messagerie : on ne peut lire, écrire ou marquer comme lue
// qu'une conversation avec un partenaire en relation coach↔athlète (canChat).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv, coachToken, coachId, tokenA, idA, idB;

before(async () => {
  srv = await startServer();

  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  coachToken = login.body.token;
  coachId = login.body.user.id;

  // Le coach crée deux athlètes actifs, tous deux rattachés à lui.
  const a = await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email: 'athleteA@test.local', password: 'longenough1' } });
  const b = await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email: 'athleteB@test.local', password: 'longenough1' } });
  idA = a.body.user.id;
  idB = b.body.user.id;

  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'athleteA@test.local', password: 'longenough1' } });
  tokenA = la.body.token;
  assert.ok(tokenA && idA && idB && coachId, 'setup messagerie complet');
});
after(async () => { if (srv) await srv.stop(); });

test('un athlète peut envoyer un message à son coach', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/messages/${coachId}`, { token: tokenA, body: { text: 'Bonjour coach' } });
  assert.equal(r.status, 200);
});

test('un athlète peut lire la conversation avec son coach', async () => {
  const r = await api(srv.baseUrl, 'GET', `/api/messages/${coachId}`, { token: tokenA });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.messages));
});

test('un athlète peut marquer comme lue la conversation avec son coach', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/messages/${coachId}/read`, { token: tokenA });
  assert.equal(r.status, 200);
});

test('un athlète NE peut PAS écrire à un autre athlète (pas de relation)', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/messages/${idB}`, { token: tokenA, body: { text: 'coucou' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden');
});

test('un athlète NE peut PAS lire la conversation avec un autre athlète', async () => {
  const r = await api(srv.baseUrl, 'GET', `/api/messages/${idB}`, { token: tokenA });
  assert.equal(r.status, 403);
});

test('un athlète NE peut PAS marquer comme lue une conversation avec un autre athlète (régression)', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/messages/${idB}/read`, { token: tokenA });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden');
});
