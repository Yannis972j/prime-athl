// Tests de cohérence des stats du widget d'accueil (/api/widget).
// Régression : les séances stockent leur date en chaîne ISO, donc trier par "b.date - a.date"
// (soustraction de chaînes → NaN) laissait lastSession non trié → dernière séance erronée.
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

// Une séance minimale avec 1 exercice, 1 série "done" → volume = weight*reps.
const mkSession = (name, isoDate, weight, reps) => ({
  name, date: isoDate, totalVolume: weight * reps,
  exercises: [{ name: 'Squat', muscle: 'Jambes', sets: [{ weight, reps, done: true }] }],
});

test('widget.lastSession est bien la séance la plus récente (ordre d\'insertion ≠ ordre des dates)', async () => {
  // Insertion volontairement dans le désordre chronologique.
  await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: mkSession('Juin',      '2026-06-01T10:00:00.000Z', 100, 5) });
  await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: mkSession('Septembre', '2026-09-01T10:00:00.000Z', 120, 5) }); // la plus récente
  await api(srv.baseUrl, 'POST', '/api/sessions', { token, body: mkSession('Mars',      '2026-03-01T10:00:00.000Z',  80, 5) });

  const r = await api(srv.baseUrl, 'GET', '/api/widget', { token });
  assert.equal(r.status, 200);
  assert.ok(r.body.lastSession, 'une dernière séance doit être renvoyée');
  assert.equal(r.body.lastSession.name, 'Septembre', 'la dernière séance doit être la plus récente par date');
});

test('widget.weekStats.volume est la somme des volumes des séances de la semaine courante', async () => {
  // Nouvelle instance isolée pour ne pas mélanger avec les séances du test précédent.
  const s2 = await startServer();
  try {
    const login = await api(s2.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
    const tk = login.body.token;
    const now = new Date().toISOString();
    await api(s2.baseUrl, 'POST', '/api/sessions', { token: tk, body: mkSession('A', now, 100, 5) }); // vol 500
    await api(s2.baseUrl, 'POST', '/api/sessions', { token: tk, body: mkSession('B', now, 100, 3) }); // vol 300
    // Séance hors semaine courante : ne doit PAS compter.
    await api(s2.baseUrl, 'POST', '/api/sessions', { token: tk, body: mkSession('Vieille', '2025-01-01T10:00:00.000Z', 999, 9) });

    const r = await api(s2.baseUrl, 'GET', '/api/widget', { token: tk });
    assert.equal(r.status, 200);
    assert.equal(r.body.weekStats.volume, 800, 'volume hebdo = somme des volumes de la semaine (500+300)');
    assert.equal(r.body.weekStats.sessions, 2, 'nombre de séances de la semaine courante');
  } finally {
    await s2.stop();
  }
});
