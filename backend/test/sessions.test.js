// Garantit que les sauvegardes de séance après validation sont opérationnelles :
// - une séance validée (POST /api/sessions) est bien persistée et relisible ;
// - la fourchette de reps cible (repsStr) est CONSERVÉE côté serveur (sert à la détection de
//   surcharge progressive) — régression : le sanitizer la strippait ;
// - une édition (PATCH /api/sessions/:id) conserve aussi la fourchette et met à jour la séance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

let srv, token;
before(async () => {
  srv = await startServer();
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  token = login.body.token;
});
after(async () => { if (srv) await srv.stop(); });

const sessionBody = () => ({
  name: 'BAS DU CORPS 1',
  date: new Date().toISOString(),
  totalVolume: 90 * 12 + 90 * 12, // 2 séries de 90kg × 12
  rpe: 8,
  duration: 60,
  exercises: [{
    name: 'Hip Thrust', muscle: 'Fessiers', repsStr: '10-12',
    sets: [
      { weight: 90, reps: 12, done: true },
      { weight: 90, reps: 12, done: true },
    ],
  }],
});

test('une séance validée est persistée et relisible', async () => {
  const post = await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: sessionBody() });
  assert.equal(post.status, 200, 'POST /api/sessions doit répondre 200');

  const get = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  assert.equal(get.status, 200);
  const sess = (get.body || []).find(s => s.name === 'BAS DU CORPS 1');
  assert.ok(sess, 'la séance validée doit être relisible');
  assert.equal(sess.totalVolume, 2160, 'le volume total doit être conservé');
  assert.equal(sess.rpe, 8, 'le RPE doit être conservé');
  assert.equal(sess.exercises.length, 1);
  assert.equal(sess.exercises[0].sets.length, 2, 'les 2 séries validées doivent être conservées');
  assert.equal(sess.exercises[0].sets[0].done, true, 'les séries validées portent done:true');
});

test('la fourchette de reps (repsStr) est conservée à la sauvegarde', async () => {
  await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: sessionBody() });
  const get = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  const sess = (get.body || []).find(s => s.name === 'BAS DU CORPS 1');
  assert.ok(sess, 'séance présente');
  assert.equal(sess.exercises[0].repsStr, '10-12', 'la fourchette de reps doit survivre au sanitizer serveur');
});

test('éditer une séance validée conserve la fourchette et met à jour la séance', async () => {
  const s2 = await startServer();
  try {
    const login = await api(s2.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
    const tk = login.body.token;
    await api(s2.baseUrl, 'POST', '/api/sessions', { token: tk, body: sessionBody() });
    let list = await api(s2.baseUrl, 'GET', '/api/sessions', { token: tk });
    const id = list.body[0].id;

    // Correction : on ajoute une 3e série (comme "ajouter une série oubliée").
    const patch = await api(s2.baseUrl, 'PATCH', `/api/sessions/${id}`, { token: tk, body: {
      exercises: [{
        name: 'Hip Thrust', muscle: 'Fessiers', repsStr: '10-12',
        sets: [
          { weight: 90, reps: 12, done: true },
          { weight: 90, reps: 12, done: true },
          { weight: 90, reps: 10, done: true },
        ],
      }],
      totalVolume: 90 * (12 + 12 + 10),
    }});
    assert.equal(patch.status, 200, 'PATCH doit répondre 200');

    list = await api(s2.baseUrl, 'GET', '/api/sessions', { token: tk });
    const sess = list.body.find(s => s.id === id);
    assert.equal(sess.exercises[0].sets.length, 3, 'la série ajoutée doit être persistée');
    assert.equal(sess.exercises[0].repsStr, '10-12', 'la fourchette doit survivre à l\'édition');
    assert.equal(sess.totalVolume, 3060, 'le volume doit être recalculé/conservé');
  } finally {
    await s2.stop();
  }
});
