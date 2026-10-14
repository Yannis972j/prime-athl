// Circuits d'une séance (CIRCUIT 1/2/3, ÉCHAUFFEMENT) dans les récaps :
//  · regroupement par bloc (groupExercisesByType) + en-têtes (groupHeaderInfo)
//  · retrouver les circuits d'une ancienne séance depuis la bibliothèque (withInferredBlocks)
//  · le libellé de bloc est bien conservé à l'enregistrement (serveur)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
function extractConst(name) {
  const m = html.match(new RegExp(`^const ${name}=.*;$`, 'm'));
  assert.ok(m, `const ${name} introuvable`);
  return m[0];
}
const T = { accent: '#BFA060' };
const lib = new Function('T', `
  ${extractConst('STYLE_COLORS')}
  ${extractConst('CIRCUIT_COLORS')}
  ${['normExerciseName', 'exType', 'groupExercisesByType', 'withInferredBlocks', 'groupHeaderInfo'].map(extractFn).join('\n')}
  return { groupExercisesByType, withInferredBlocks, groupHeaderInfo };
`)(T);

const ab = (name, block) => ({ name, style: 'ABDOS', ...(block ? { block } : {}), sets: [] });
const session = (withBlock) => [
  ab('SQUATS', withBlock && 'CIRCUIT 1'), ab('BURPEES', withBlock && 'CIRCUIT 1'),
  ab('CORDE À SAUTER', withBlock && 'CIRCUIT 2'), ab('SQUATS JUMP', withBlock && 'CIRCUIT 2'),
  ab('CHAISE', withBlock && 'CIRCUIT 3'),
  { name: 'TAPIS DE COURSE', style: 'CARDIO', sets: [] },
];

test('exos ABDOS de circuits différents : un groupe par circuit', () => {
  const g = lib.groupExercisesByType(session(true));
  assert.deepEqual(g.map(x => x.label), ['CIRCUIT 1', 'CIRCUIT 2', 'CIRCUIT 3', null]);
  assert.deepEqual(g.map(x => x.items.length), [2, 2, 1, 1]);
});

test('sans libellé de bloc : comportement historique (un seul groupe ABDOS)', () => {
  const g = lib.groupExercisesByType(session(false));
  assert.equal(g[0].items.length, 5);
  assert.equal(g[0].style, 'ABDOS');
});

test('en-têtes : CIRCUIT n coloré, ÉCHAUFFEMENT, SUPERSET (comme l\'aperçu Biblio)', () => {
  const c1 = lib.groupHeaderInfo({ style: 'ABDOS', label: 'CIRCUIT 1', items: [1, 2] });
  const c2 = lib.groupHeaderInfo({ style: 'ABDOS', label: 'CIRCUIT 2', items: [1] });
  assert.equal(c1.hTxt, 'CIRCUIT 1');
  assert.equal(c1.hSub, 'enchaîner sans repos');
  assert.notEqual(c1.color, c2.color, 'une couleur par circuit');
  const w = lib.groupHeaderInfo({ style: 'ABDOS', label: 'ÉCHAUFFEMENT', items: [1] });
  assert.equal(w.hSub, 'à faire en premier');
  const s = lib.groupHeaderInfo({ style: 'SUPERSET', items: [1, 2] });
  assert.equal(s.hTxt, 'SUPERSET');
  assert.equal(lib.groupHeaderInfo({ style: 'CLASSIQUE', items: [1] }).hTxt, null);
});

test('ancienne séance sans blocs : circuits retrouvés depuis une séance de bibliothèque identique', () => {
  const out = lib.withInferredBlocks(session(false), [{ exercises: session(true) }]);
  assert.deepEqual(out.map(e => e.block || null), ['CIRCUIT 1', 'CIRCUIT 1', 'CIRCUIT 2', 'CIRCUIT 2', 'CIRCUIT 3', null]);
});

test('inférence : pas de correspondance exacte → séance inchangée', () => {
  const other = session(true).slice(0, 4);                 // autre longueur
  assert.equal(lib.withInferredBlocks(session(false), [{ exercises: other }]).some(e => e.block), false);
  const renamed = session(true); renamed[1].name = 'AUTRE EXO'; // autre nom
  assert.equal(lib.withInferredBlocks(session(false), [{ exercises: renamed }]).some(e => e.block), false);
  assert.equal(lib.withInferredBlocks(session(false), []).some(e => e.block), false);
});

test('inférence : une séance qui porte déjà des blocs n\'est pas modifiée', () => {
  const already = session(true);
  assert.equal(lib.withInferredBlocks(already, [{ exercises: session(true).reverse() }]), already);
});

// ── Serveur : le libellé de bloc survit à l'enregistrement ──────────────────────────
let srv, athleteToken, athleteId, coachToken;
before(async () => {
  srv = await startServer();
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  coachToken = login.body.token;
  const a = await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email: 'circuits@test.local', password: 'longenough1' } });
  athleteId = a.body.user.id;
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'circuits@test.local', password: 'longenough1' } });
  athleteToken = la.body.token;
});
after(async () => { if (srv) await srv.stop(); });

const exs = () => [
  { name: 'SQUATS', style: 'ABDOS', block: 'CIRCUIT 1', sets: [{ weight: 0, reps: 20, done: true }] },
  { name: 'CHAISE', style: 'ABDOS', block: 'ÉCHAUFFEMENT', sets: [{ weight: 0, reps: 0, done: true }] },
];

test('POST /api/sessions conserve le libellé de bloc', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/sessions', { token: athleteToken, body: { name: 'POIDS DU CORPS 2', date: new Date().toISOString(), totalVolume: 0, exercises: exs() } });
  assert.equal(r.status, 200);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken });
  const s = list.body.find(x => x.name === 'POIDS DU CORPS 2');
  assert.deepEqual(s.exercises.map(e => e.block), ['CIRCUIT 1', 'ÉCHAUFFEMENT']);
});

test('séance ajoutée par le coach : le libellé de bloc est conservé aussi', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coachToken, body: { name: 'CIRCUITS COACH', date: new Date().toISOString(), exercises: exs(), totalVolume: 0, duration: 30 } });
  assert.equal(r.status, 200);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken });
  const s = list.body.find(x => x.name === 'CIRCUITS COACH');
  assert.deepEqual(s.exercises.map(e => e.block), ['CIRCUIT 1', 'ÉCHAUFFEMENT']);
});
