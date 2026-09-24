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

// Régression : le drapeau `deload` était persisté mais ABSENT du sérialiseur de GET /api/sessions,
// donc l'historique relu croyait à une semaine normale et affichait une alerte de recul au lieu du
// bandeau neutre de décharge. Il doit faire l'aller-retour.
test('le drapeau deload survit à l\'aller-retour serveur', async () => {
  await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: { ...sessionBody(), name: 'DELOAD ROUNDTRIP', deload: true } });
  const get = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  const sess = (get.body || []).find(s => s.name === 'DELOAD ROUNDTRIP');
  assert.ok(sess, 'séance de décharge présente');
  assert.equal(sess.deload, true, 'GET /api/sessions doit renvoyer deload:true (sinon le récap la traite comme une semaine normale)');
});

test('une séance normale ne porte pas deload à la relecture', async () => {
  await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: { ...sessionBody(), name: 'NORMALE ROUNDTRIP' } });
  const get = await api(srv.baseUrl, 'GET', '/api/sessions', { token });
  const sess = (get.body || []).find(s => s.name === 'NORMALE ROUNDTRIP');
  assert.ok(sess, 'séance présente');
  assert.equal(sess.deload, false, 'une séance non-décharge doit revenir deload:false');
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

// Message pop-up du coach : validé avec une montée de charge, il doit être livré à l'athlète via
// /api/program (coachNote), avec le récap ancien→nouveau, puis effacé une fois acquitté (ack).
test('le message pop-up du coach est livré à l\'athlète puis acquitté', async () => {
  const s = await startServer();
  try {
    const cl = await api(s.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
    const coachToken = cl.body.token;
    const created = await api(s.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email: 'notes-athlete@test.local', password: 'longenough1' } });
    const athleteId = created.body?.athlete?.id || created.body?.id || created.body?.user?.id;
    assert.ok(athleteId, 'athlète créé');
    const al = await api(s.baseUrl, 'POST', '/api/auth/login', { body: { email: 'notes-athlete@test.local', password: 'longenough1' } });
    const athleteToken = al.body.token;

    const ov = await api(s.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/overload`, { token: coachToken, body: {
      sessionName: 'HAUT DU CORPS : DOS',
      updates: [{ name: 'Tirage vertical', weight: 42.5, from: 40 }],
      note: 'Beau boulot, on monte le tirage cette semaine.',
    }});
    assert.equal(ov.status, 200, 'overload avec note doit répondre 200');

    const prog = await api(s.baseUrl, 'GET', '/api/program', { token: athleteToken });
    assert.ok(prog.body.coachNote, 'la note doit être livrée à l\'athlète');
    assert.equal(prog.body.coachNote.message, 'Beau boulot, on monte le tirage cette semaine.');
    assert.equal(prog.body.coachNote.updates[0].from, 40, 'ancienne charge présente');
    assert.equal(prog.body.coachNote.updates[0].to, 42.5, 'nouvelle charge présente');

    const ack = await api(s.baseUrl, 'POST', '/api/my-coach-note/ack', { token: athleteToken });
    assert.equal(ack.status, 200);
    const prog2 = await api(s.baseUrl, 'GET', '/api/program', { token: athleteToken });
    assert.equal(prog2.body.coachNote, null, 'après ack la note ne revient plus');
  } finally {
    await s.stop();
  }
});
