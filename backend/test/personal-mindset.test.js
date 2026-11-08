// Citations de mindset PERSONNALISÉES (10 citations « natation » d'Inaya) : elles n'apparaissent QUE pour elle.
// - posées au démarrage uniquement si UN SEUL athlète s'appelle Inaya, une seule fois ;
// - seul le coach peut les modifier (jamais l'athlète) ; la liste est nettoyée/bornée ;
// - côté app, elles remplacent les phrases génériques du Mindset de CET athlète (et le récap garde ses limites).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SWIM_PHRASES, sanitizePhrases, seedSwimPhrases } from '../personal-mindset.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');

test('les 10 citations sont exactement celles du coach', () => {
  assert.equal(SWIM_PHRASES.length, 10);
  assert.equal(SWIM_PHRASES[0], 'Chaque goutte de sueur à la salle est une vague de progrès dans ta transformation.');
  assert.equal(SWIM_PHRASES[3], 'Ne cherche pas à aller plus vite que les autres. Cherche à nager plus loin que ton ancien toi.');
  assert.equal(SWIM_PHRASES[9], 'Plonge avec ambition. Entraîne-toi avec discipline. Ressors plus fort.');
  assert.equal(new Set(SWIM_PHRASES).size, 10);
  for (const p of SWIM_PHRASES) assert.ok(!/[«»]/.test(p) && !/^\d+\./.test(p), p);
});

test('sanitizePhrases : nettoie, déduplique, borne ; refuse ce qui n\'est pas une liste', () => {
  assert.deepEqual(sanitizePhrases(['  Bonjour   toi ', '', 'Bonjour toi', 12, null]), ['Bonjour toi', '12']);
  assert.equal(sanitizePhrases('texte'), null);
  assert.equal(sanitizePhrases(undefined), null);
  assert.deepEqual(sanitizePhrases([]), []);
  assert.equal(sanitizePhrases(['x'.repeat(500)])[0].length, 240);
  assert.equal(sanitizePhrases(Array.from({ length: 80 }, (_, i) => 'p' + i)).length, 30);
});

test('seedSwimPhrases : un seul athlète « Inaya », une seule fois, jamais les autres', () => {
  const mk = (id, extra) => ({ id, role: 'athlete', firstName: 'Autre', ...extra });
  const users = { a: mk('a', { firstName: 'Inaya', lastName: 'Moutachy' }), b: mk('b'), c: mk('c', { firstName: 'Inayat' }), d: { id: 'd', role: 'coach', firstName: 'Inaya' } };
  const r = seedSwimPhrases(users);
  assert.equal(r.changed, true); assert.equal(r.userId, 'a');
  assert.deepEqual(users.a.mindsetPhrases, SWIM_PHRASES);
  assert.equal(users.b.mindsetPhrases, undefined); assert.equal(users.c.mindsetPhrases, undefined); assert.equal(users.d.mindsetPhrases, undefined);
  // deuxième démarrage : rien ne change, même si le coach a vidé la liste
  users.a.mindsetPhrases = [];
  assert.equal(seedSwimPhrases(users).changed, false);
  assert.deepEqual(users.a.mindsetPhrases, []);
  // majuscules / accents / espaces tolérés ; deux « Inaya » → personne
  assert.equal(seedSwimPhrases({ x: mk('x', { firstName: ' INAYA ' }) }).changed, true);
  const two = { x: mk('x', { firstName: 'Inaya' }), y: mk('y', { firstName: 'inaya' }) };
  const r2 = seedSwimPhrases(two);
  assert.equal(r2.changed, false); assert.equal(r2.count, 2);
  assert.equal(two.x.mindsetPhrases, undefined); assert.equal(two.y.mindsetPhrases, undefined);
  assert.equal(seedSwimPhrases({}).changed, false);
});

test('démarrage du serveur : les citations sont posées sur Inaya et sur personne d\'autre', async () => {
  const dbPath = path.join(os.tmpdir(), `prime-athl-inaya-${crypto.randomUUID()}.json`);
  const base = { role: 'athlete', status: 'active', passwordHash: 'x', coachId: null, tokenVersion: 0, createdAt: Date.now() };
  fs.writeFileSync(dbPath, JSON.stringify({ users: {
    in1: { ...base, id: 'in1', email: 'inaya@x.test', firstName: 'Inaya', lastName: 'Moutachy' },
    ot1: { ...base, id: 'ot1', email: 'autre@x.test', firstName: 'Laura', lastName: 'Carnier' },
  } }));
  const s = await startServer({ DB_PATH: dbPath });
  try {
    let db = null;
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); try { db = JSON.parse(fs.readFileSync(dbPath, 'utf8')); if (db.users.in1.mindsetPhrases) break; } catch {} }
    assert.deepEqual(db.users.in1.mindsetPhrases, SWIM_PHRASES, 'Inaya a ses 10 citations');
    assert.equal(db.users.ot1.mindsetPhrases, undefined, 'les autres athlètes : rien');
  } finally { await s.stop(); }
});

let srv, coach, ath1, ath2, tok1;
before(async () => {
  srv = await startServer();
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  for (const [e, f] of [['p1@test.local', 'Nageuse'], ['p2@test.local', 'Autre']]) await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: e, password: 'longenough1', firstName: f, lastName: 'T' } });
  const l1 = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'p1@test.local', password: 'longenough1' } });
  const l2 = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'p2@test.local', password: 'longenough1' } });
  ath1 = l1.body.user.id; tok1 = l1.body.token; ath2 = l2.body.user.id;
});
after(async () => { if (srv) await srv.stop(); });

test('serveur : le coach pose les citations d\'UN athlète ; l\'autre athlète n\'est pas touché ; l\'athlète ne peut pas les modifier', async () => {
  const set = await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ath1}`, { token: coach, body: { mindsetPhrases: ['  Plonge.  ', 'Ressors plus fort.', ''] } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.mindsetPhrases, ['Plonge.', 'Ressors plus fort.']);
  const me = await api(srv.baseUrl, 'GET', '/api/me', { token: tok1 });
  assert.deepEqual(me.body.mindsetPhrases, ['Plonge.', 'Ressors plus fort.'], 'l\'athlète les reçoit dans son profil');
  const other = await api(srv.baseUrl, 'GET', `/api/coach/athletes/${ath2}`, { token: coach });
  assert.deepEqual(other.body.mindsetPhrases, [], 'l\'autre athlète : aucune citation perso');
  // l'athlète ne peut pas se les attribuer
  await api(srv.baseUrl, 'PATCH', '/api/me', { token: tok1, body: { mindsetPhrases: ['Je me les donne'] } });
  const again = await api(srv.baseUrl, 'GET', '/api/me', { token: tok1 });
  assert.deepEqual(again.body.mindsetPhrases, ['Plonge.', 'Ressors plus fort.']);
  // format invalide refusé ; liste vide = retour aux phrases génériques
  assert.equal((await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ath1}`, { token: coach, body: { mindsetPhrases: 'texte' } })).status, 400);
  const clear = await api(srv.baseUrl, 'PATCH', `/api/coach/athletes/${ath1}`, { token: coach, body: { mindsetPhrases: [] } });
  assert.deepEqual(clear.body.mindsetPhrases, []);
});

// ── côté app ─────────────────────────────────────────────────────────────────────────────────────────────────
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, a); return html.slice(i, j); };
const SRC = slice('function normExerciseName', '// Clé de comparaison de NOMS DE SÉANCE') + '\n'
  + slice('const CONGRATS_MESSAGES', 'function computeGoalsCtx') + '\n'
  + slice('function computeCoachCtx', 'function RecapPersonal') + '\n'
  + slice('// Hash déterministe', 'function sessionVolumeOf') + '\n'
  + [slice('const DELOAD_MINDSET', '];\n') + '];', slice('const POST_DELOAD_MINDSET', '];\n') + '];', slice('const MENSTRUAL_MINDSET', '];\n') + '];'].join('\n');
const L = new Function('gg', SRC + '\nreturn { computeCoachCtx, motivationQuote };')((g, a, b) => b);

const COMPS = [
  [null, null], // première séance
  [{ prsCount: 0, upCount: 0, downCount: 0, sameCount: 3, totalExercises: 3, exercises: [] }, { previous: 8000, current: 8000 }],
  [{ prsCount: 2, upCount: 4, downCount: 0, sameCount: 0, totalExercises: 4, exercises: [] }, { previous: 8000, current: 9400 }],
  [{ prsCount: 0, upCount: 1, downCount: 1, sameCount: 1, totalExercises: 3, exercises: [] }, { previous: 8000, current: 7900 }],
  [null, { previous: 9000, current: 5000 }], // baisse nette
];

test('app : l\'athlète avec citations perso ne voit QUE ses citations, quelle que soit la performance', () => {
  const ctx = L.computeCoachCtx({ mindsetPhrases: SWIM_PHRASES });
  assert.ok(ctx, 'un profil avec seulement des citations est exploité');
  const seen = new Set();
  for (let i = 0; i < 300; i++) for (const [c, v] of COMPS) seen.add(L.motivationQuote(c, v, 's' + i, false, false, null, 'f', ctx));
  for (const q of seen) assert.ok(SWIM_PHRASES.includes(q), 'phrase étrangère : ' + q);
  assert.equal(seen.size, 10, 'les 10 citations sortent toutes');
});

test('app : sans citations perso, jamais une citation de natation (les autres athlètes)', () => {
  for (const prof of [{}, { mindsetPhrases: [] }, { cpBanterLevel: 5 }, { cpDontDo: ['Trop agressif'] }]) {
    const ctx = L.computeCoachCtx(prof);
    for (let i = 0; i < 200; i++) for (const [c, v] of COMPS) assert.ok(!SWIM_PHRASES.includes(L.motivationQuote(c, v, 'z' + i, false, false, null, 'f', ctx)));
  }
});

test('app : décharge / reprise / douleurs de cycle gardent leurs propres phrases ; les limites cochées sont respectées', () => {
  const ctx = L.computeCoachCtx({ mindsetPhrases: SWIM_PHRASES });
  for (let i = 0; i < 60; i++) for (const [d, post, why] of [[true, false, null], [true, false, 'menstrual'], [false, true, null]])
    assert.ok(!SWIM_PHRASES.includes(L.motivationQuote(COMPS[1][0], COMPS[1][1], 'd' + i, d, post, null, 'f', ctx, why)));
  const lim = L.computeCoachCtx({ mindsetPhrases: SWIM_PHRASES, cpDontDo: ['Commenter mon physique', 'Me comparer aux autres'] });
  for (let i = 0; i < 300; i++) { const q = L.motivationQuote(COMPS[2][0], COMPS[2][1], 'l' + i, false, false, null, 'f', lim); assert.doesNotMatch(q, /physique|miroir|autres/i, q); }
});

test('app : le coach dispose du champ « citations perso » dans l\'onglet profil de l\'athlète', () => {
  assert.match(html, /<CoachMindsetPhrases phrases=\{a\.mindsetPhrases\} onSave=\{ph=>patchAthlete\(\{mindsetPhrases:ph\}\)\}\/>/);
});
