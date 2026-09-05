// Tests de la route /api/nutrition/copy-day : validation des entrées + protection
// contre la pollution de prototype (régression corrigée dans la PR #129).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv, token;
before(async () => {
  srv = await startServer();
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  token = login.body.token;
  assert.ok(token, 'le coach principal doit pouvoir se connecter');
});
after(async () => { if (srv) await srv.stop(); });

test('copy-day sans token → 401', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/nutrition/copy-day', { body: { fromDate: '2026-01-01', toDate: '2026-01-02' } });
  assert.equal(r.status, 401);
});

test('copy-day sans dates → 400 dates_required', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/nutrition/copy-day', { token, body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'dates_required');
});

test('copy-day avec date au mauvais format → 400 invalid_date', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/nutrition/copy-day', { token, body: { fromDate: '01/01/2026', toDate: '2026-01-02' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_date');
});

test('copy-day avec dates valides → 200 ok', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/nutrition/copy-day', {
    token,
    body: { fromDate: '2026-01-01', toDate: '2026-01-02', validatedEntries: { repas1: true } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('copy-day filtre les clés dangereuses (__proto__/constructor) — anti pollution de prototype', async () => {
  // On glisse des clés dangereuses dans validatedEntries. Le serveur doit les retirer
  // via isSafeObjectKey avant de les écrire dans nutritionLogs.
  const r = await api(srv.baseUrl, 'POST', '/api/nutrition/copy-day', {
    token,
    body: {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      validatedEntries: {
        repas_ok: true,
        __proto__: { polluted: true },
        constructor: { polluted: true },
        prototype: { polluted: true },
      },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  // On relit les données via l'export RGPD et on vérifie le contenu réellement stocké.
  const exp = await fetch(`${srv.baseUrl}/api/me/export`, { headers: { Authorization: `Bearer ${token}` } });
  const data = JSON.parse(await exp.text());
  const validated = data.nutritionLogs['2026-02-02'].validated;
  const keys = Object.keys(validated);

  assert.ok(keys.includes('repas_ok'), 'la clé légitime doit être conservée');
  assert.ok(!keys.includes('__proto__'), '__proto__ doit être filtré');
  assert.ok(!keys.includes('constructor'), 'constructor doit être filtré');
  assert.ok(!keys.includes('prototype'), 'prototype doit être filtré');
});
