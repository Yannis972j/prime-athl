// Séance saisie par le coach pour un athlète : un renvoi avec le même clientId (réponse perdue, reprise réseau,
// file d'attente du téléphone) ne crée JAMAIS une 2e séance. Sans clientId : comportement inchangé.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv, coach, athleteId, atok;
before(async () => {
  srv = await startServer();
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'idem@test.local', password: 'longenough1', firstName: 'Ida', lastName: 'Dem' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'idem@test.local', password: 'longenough1' } });
  athleteId = la.body.user.id; atok = la.body.token;
});
after(async () => { if (srv) await srv.stop(); });

const body = (extra = {}) => ({ name: 'JAMBES', date: new Date(Date.now() - 3600e3).toISOString(), totalVolume: 600, duration: 45,
  exercises: [{ name: 'Squat', muscle: 'JAMBES', sets: [{ weight: 60, reps: 10, done: true }] }], ...extra });
const mine = async () => (await api(srv.baseUrl, 'GET', '/api/sessions', { token: atok })).body;
const post = b => api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body: b });

test('même clientId : une seule séance, le renvoi répond avec la même id', async () => {
  const n0 = (await mine()).length;
  const first = await post(body({ clientId: 'abc-123' }));
  assert.equal(first.status, 200);
  const again = await post(body({ clientId: 'abc-123' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.duplicate, true);
  const list = await mine();
  assert.equal(list.length, n0 + 1, 'une seule séance créée pour les deux envois');
  assert.equal(list.filter(s => s.id === first.body.id).length, 1);
});

test('clientId différent : deux séances ; sans clientId : comportement inchangé', async () => {
  const before = (await mine()).length;
  const a = await post(body({ clientId: 'x-1' })), b = await post(body({ clientId: 'x-2' }));
  assert.notEqual(a.body.id, b.body.id);
  const c = await post(body()), d = await post(body());
  assert.equal(c.status, 200); assert.equal(d.status, 200);
  assert.notEqual(c.body.id, d.body.id, 'sans clientId, pas de dédoublonnage (comme avant)');
  assert.equal((await mine()).length, before + 4);
});

test('le même clientId sur un autre athlète n\'est pas confondu', async () => {
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'idem2@test.local', password: 'longenough1', firstName: 'Jo', lastName: 'Autre' } });
  const l2 = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'idem2@test.local', password: 'longenough1' } });
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${l2.body.user.id}/sessions`, { token: coach, body: body({ clientId: 'abc-123' }) });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.duplicate, true, 'créée pour l\'autre athlète');
});
