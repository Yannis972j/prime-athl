// Sauvegarde des données : le coach principal voit si la dernière écriture a réussi ou échoué
// (GET /api/admin/health → lastSaveOkAt / saveError) au lieu d'un simple console.error invisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

async function health(srv) {
  const t = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  // une écriture : crée un athlète (déclenche persist()), puis laisse passer le debounce (200 ms)
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: t, body: { email: 'save@test.local', password: 'longenough1', firstName: 'Sa', lastName: 'Ve' } });
  await new Promise(r => setTimeout(r, 900));
  return (await api(srv.baseUrl, 'GET', '/api/admin/health', { token: t })).body;
}

test('écriture réussie : date du dernier succès, aucune erreur', async () => {
  const srv = await startServer();
  try {
    const h = await health(srv);
    assert.equal(h.saveError, null);
    assert.equal(typeof h.lastSaveOkAt, 'number');
    assert.ok(Date.now() - h.lastSaveOkAt < 60000);
  } finally { await srv.stop(); }
});

test('écriture impossible (disque inaccessible) : l\'erreur est exposée au coach', async () => {
  const srv = await startServer({ DB_PATH: '/proc/inexistant/prime-athl.json' });
  try {
    const h = await health(srv);
    assert.ok(h.saveError, 'erreur de sauvegarde visible');
    assert.equal(h.saveError.kind, 'local');
    assert.ok(h.saveError.message.length > 0);
    assert.ok(h.saveError.count >= 1);
    assert.equal(h.lastSaveOkAt, null);
  } finally { await srv.stop(); }
});
