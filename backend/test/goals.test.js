// Fiche « Mes objectifs » : les 4 champs de la fiche (goalMotivation, goalDeadline,
// goalWeeklyTarget, goalStyle) doivent être persistés côté serveur et relisibles via /api/me.
// Ces valeurs alimentent la personnalisation des pop-ups d'inactivité/régularité côté client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv, coachToken;
before(async () => {
  srv = await startServer();
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  coachToken = login.body.token;
});
after(async () => { if (srv) await srv.stop(); });

async function createAthlete(email) {
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email, password: 'longenough1' } });
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password: 'longenough1' } });
  return login.body.token;
}

test('les 4 champs de la fiche sont persistés puis relus dans /api/me', async () => {
  const token = await createAthlete('goals1@test.local');
  const patch = await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: {
    objective: 'Prise de masse',
    goalMotivation: 'Retrouver un corps dont je suis fier avant l\'été.',
    goalDeadline: '2027-06-15',
    goalWeeklyTarget: 4,
    goalStyle: 'hypertrophy',
  }});
  assert.equal(patch.status, 200);
  const me = await api(srv.baseUrl, 'GET', '/api/me', { token });
  assert.equal(me.body.objective, 'Prise de masse');
  assert.equal(me.body.goalMotivation, 'Retrouver un corps dont je suis fier avant l\'été.');
  assert.equal(me.body.goalDeadline, '2027-06-15');
  assert.equal(me.body.goalWeeklyTarget, 4);
  assert.equal(me.body.goalStyle, 'hypertrophy');
});

test('une date invalide est rejetée avec 400', async () => {
  const token = await createAthlete('goals2@test.local');
  const patch = await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { goalDeadline: 'pas-une-date' }});
  assert.equal(patch.status, 400);
  assert.equal(patch.body.error, 'invalid_deadline');
});

test('un style inconnu est rejeté avec 400', async () => {
  const token = await createAthlete('goals3@test.local');
  const patch = await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { goalStyle: 'ninjutsu' }});
  assert.equal(patch.status, 400);
  assert.equal(patch.body.error, 'invalid_style');
});

test('la fréquence cible est bornée entre 0 et 7', async () => {
  const token = await createAthlete('goals4@test.local');
  const over = await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { goalWeeklyTarget: 42 }});
  assert.equal(over.status, 200);
  const me = await api(srv.baseUrl, 'GET', '/api/me', { token });
  assert.equal(me.body.goalWeeklyTarget, 7, '42 est ramené au max (7)');
});

test('la motivation est tronquée à 300 caractères', async () => {
  const token = await createAthlete('goals5@test.local');
  const long = 'x'.repeat(500);
  await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { goalMotivation: long }});
  const me = await api(srv.baseUrl, 'GET', '/api/me', { token });
  assert.equal(me.body.goalMotivation.length, 300);
});

test('les champs vides effacent leur valeur (deadline)', async () => {
  const token = await createAthlete('goals6@test.local');
  await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { goalDeadline: '2027-06-15' }});
  await api(srv.baseUrl, 'PATCH', '/api/me', { token, body: { goalDeadline: '' }});
  const me = await api(srv.baseUrl, 'GET', '/api/me', { token });
  assert.equal(me.body.goalDeadline, '');
});
