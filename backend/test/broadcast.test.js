// Annonce groupée du coach : un message → tous SES athlètes (pop-up + notification), acquittement par athlète,
// suivi côté coach, et aucune fuite vers les athlètes d'un autre coach.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv, coach, a1, a2;
const PW = 'longenough1';
const login = async (email) => (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: PW } })).body;

before(async () => {
  srv = await startServer();
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  for (const [email, fn] of [['bc-a1@test.local', 'Ana'], ['bc-a2@test.local', 'Ben']])
    await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email, password: PW, firstName: fn, lastName: 'Test' } });
  a1 = await login('bc-a1@test.local'); a2 = await login('bc-a2@test.local');
  // une demande d'inscription EN ATTENTE d'approbation n'est pas un destinataire
  const reg = await api(srv.baseUrl, 'POST', '/api/auth/signup', { body: { email: 'bc-pending@test.local', password: PW, role: 'athlete', firstName: 'Pia', lastName: 'Attente' } });
  assert.ok([200, 201].includes(reg.status));
});
after(async () => { if (srv) await srv.stop(); });

const send = (body, token = coach) => api(srv.baseUrl, 'POST', '/api/coach/broadcasts', { token, body });
const pending = async (u) => (await api(srv.baseUrl, 'GET', '/api/broadcasts/pending', { token: u.token })).body;

test('validation : titre et message obligatoires, longueurs, au moins un canal', async () => {
  assert.equal((await send({ message: 'x' })).body.error, 'title_required');
  assert.equal((await send({ title: 'T' })).body.error, 'message_required');
  assert.equal((await send({ title: 'T'.repeat(61), message: 'x' })).body.error, 'title_too_long');
  assert.equal((await send({ title: 'T', message: 'm'.repeat(601) })).body.error, 'message_too_long');
  assert.equal((await send({ title: 'T', message: 'x', popup: false, push: false })).body.error, 'nothing_to_send');
});

test('un athlète ne peut pas envoyer d\'annonce', async () => {
  const r = await send({ title: 'Hack', message: 'x' }, a1.token);
  assert.equal(r.status, 403);
});

test('annonce → tous les athlètes du coach la reçoivent en pop-up, une seule fois chacun', async () => {
  const r = await send({ title: 'Salle fermée samedi', message: 'La salle est fermée ce samedi.\nOn se retrouve lundi 💪', clientId: 'c-1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.recipients, 2, 'exactement les 2 athlètes du coach (pas la demande d\'inscription en attente)');
  assert.equal(typeof r.body.push.noDevice, 'number');
  for (const u of [a1, a2]) {
    const list = await pending(u);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Salle fermée samedi');
    assert.match(list[0].message, /lundi/);
    assert.ok(list[0].coachName);
  }
  // acquittement : ne revient plus pour a1, reste pour a2
  assert.equal((await api(srv.baseUrl, 'POST', `/api/broadcasts/${r.body.id}/seen`, { token: a1.token })).status, 200);
  assert.equal((await pending(a1)).length, 0);
  assert.equal((await pending(a2)).length, 1);
  // suivi côté coach : 1 lecture
  const hist = (await api(srv.baseUrl, 'GET', '/api/coach/broadcasts', { token: coach })).body;
  const row = hist.broadcasts.find(b => b.id === r.body.id);
  assert.equal(row.seen, 1);
  assert.equal(row.recipients, 2);
});

test('renvoi avec le même clientId : pas de 2e annonce', async () => {
  const before = (await pending(a2)).length;
  const r1 = await send({ title: 'Une seule fois', message: 'm', clientId: 'dup-1' });
  const r2 = await send({ title: 'Une seule fois', message: 'm', clientId: 'dup-1' });
  assert.equal(r2.body.duplicate, true);
  assert.equal(r2.body.id, r1.body.id);
  assert.equal((await pending(a2)).length, before + 1);
});

test('pop-up désactivé : rien dans la file des pop-ups (notification seule)', async () => {
  const before = (await pending(a2)).length;
  const r = await send({ title: 'Notif seule', message: 'm', popup: false, push: true });
  assert.equal(r.status, 200);
  assert.equal((await pending(a2)).length, before);
});

test('on ne peut pas acquitter l\'annonce d\'un autre / une annonce inconnue', async () => {
  const r = await send({ title: 'Pour mes athlètes', message: 'm' });
  assert.equal((await api(srv.baseUrl, 'POST', '/api/broadcasts/__proto__/seen', { token: a1.token })).status, 404);
  assert.equal((await api(srv.baseUrl, 'POST', '/api/broadcasts/inconnue/seen', { token: a1.token })).status, 404);
  assert.equal(r.status, 200);
});

test('coach sans athlète : refus clair', async () => {
  const empty = await startServer();
  try {
    const t = (await api(empty.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
    const r = await api(empty.baseUrl, 'POST', '/api/coach/broadcasts', { token: t, body: { title: 'T', message: 'm' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'no_athletes');
    const h = (await api(empty.baseUrl, 'GET', '/api/coach/broadcasts', { token: t })).body;
    assert.equal(h.athleteCount, 0);
  } finally { await empty.stop(); }
});
