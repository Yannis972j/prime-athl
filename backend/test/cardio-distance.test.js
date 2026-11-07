// Cardio (SKIERG, rameur…) : la DISTANCE réalisée (m) est le repère de progression, comme charge/reps en muscu.
// - saisie par série, conservée à l'enregistrement (athlète et coach) ;
// - comparée à la dernière fois dans le récap (↑ ↓ =, PR si plus loin) ;
// - repère « dernière fois » affiché pendant la séance ; sans distance, comportement inchangé.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const names = ['normExerciseName', 'isUnilateralName', 'isUnilateralEx', 'isAssistedName', 'isAssistedEx', 'sessionVolumeOf',
  'setDistanceM', 'cardioDistanceTotal', 'fmtThousands', 'fmtDistanceM', 'lastCardioDistance', 'buildSessionComparison'];
const F = new Function(`${names.map(extractFn).join('\n')}\nreturn { setDistanceM, cardioDistanceTotal, fmtDistanceM, lastCardioDistance, buildSessionComparison };`)();

const sk = (...d) => ({ name: 'SKIERG', style: 'CARDIO', cardio: { duree: "5'" }, sets: d.map(x => ({ weight: 0, reps: 0, done: true, ...(x ? { distance: x } : {}) })) });
const sess = (id, date, exercises, extra = {}) => ({ id, name: 'CARDIO', date, exercises, ...extra });
const P = '2026-10-01T10:00:00Z', C = '2026-10-08T10:00:00Z';
const cmp = (prev, cur) => F.buildSessionComparison(sess('c', C, [cur]), [sess('p', P, [prev])], {}).comp;

test('distance : lecture tolérante, en mètres, bornée', () => {
  assert.equal(F.setDistanceM({ distance: '1250' }), 1250);
  assert.equal(F.setDistanceM({ distance: 1250.4 }), 1250);
  assert.equal(F.setDistanceM({ distance: '1 250' }), 1250, 'espaces de milliers tolérés');
  assert.equal(F.setDistanceM({ distance: 'abc' }), 0, 'texte non numérique : ignoré');
  assert.equal(F.setDistanceM({ distance: -5 }), 0);
  assert.equal(F.setDistanceM({}), 0);
  assert.equal(F.setDistanceM({ distance: 9999999 }), 100000);
  assert.equal(F.cardioDistanceTotal([{ distance: 300 }, { distance: '250' }, {}]), 550);
  assert.match(F.fmtDistanceM(1250), /^1[\s  ]250 m$/);
});

test('repère « dernière fois » : séance la plus récente avec distance, hors décharge', () => {
  const hist = [
    sess('a', '2026-09-01T10:00:00Z', [sk(1000)]),
    sess('b', '2026-10-01T10:00:00Z', [sk(1100, 1150)]),
    sess('c', '2026-10-05T10:00:00Z', [sk(900)], { deload: true }),
    sess('d', '2026-10-06T10:00:00Z', [sk(0)]),                     // pas de distance : ignorée
  ];
  const l = F.lastCardioDistance(hist, 'skierg');
  assert.deepEqual(l.perSet, [1100, 1150]);
  assert.equal(l.total, 2250);
  assert.equal(F.lastCardioDistance(hist, 'Rameur'), null);
  assert.equal(F.lastCardioDistance([], 'SKIERG'), null);
});

test('récap : plus loin → ↑ + PR ; moins loin → ↓ ; identique → = ; sans distance → inchangé', () => {
  const up = cmp(sk(1200), sk(1250)).exercises[0];
  assert.equal(up.status, 'up'); assert.equal(up.isPR, true); assert.equal(up.kind, 'cardio');
  assert.equal(up.curDist, 1250); assert.equal(up.prevDist, 1200); assert.equal(up.dDelta, 50);
  const down = cmp(sk(1200), sk(1150)).exercises[0];
  assert.equal(down.status, 'down'); assert.equal(down.isPR, false);
  assert.equal(cmp(sk(1200), sk(1200)).exercises[0].status, 'same');
  // pas de distance d'un côté ou des deux → 'na' comme avant (aucun faux progrès / faux recul)
  assert.equal(cmp(sk(0), sk(1250)).exercises[0].status, 'na');
  assert.equal(cmp(sk(1200), sk(0)).exercises[0].status, 'na');
  assert.equal(cmp(sk(0), sk(0)).exercises[0].status, 'na');
});

test('récap : plusieurs séries → somme comparée ; compteurs hausse/baisse alimentés', () => {
  const c = cmp(sk(300, 280, 260), sk(310, 300, 280));
  assert.equal(c.exercises[0].curDist, 890); assert.equal(c.exercises[0].prevDist, 840);
  assert.equal(c.upCount, 1); assert.equal(c.prsCount, 1); assert.equal(c.totalExercises, 1);
  const d = cmp(sk(300, 300), sk(250, 250));
  assert.equal(d.downCount, 1); assert.equal(d.upCount, 0);
});

test('récap : première fois (pas de séance précédente avec cet exo) → pas de comparaison, distance affichable', () => {
  const r = F.buildSessionComparison(sess('c', C, [sk(1250)]), [sess('p', P, [{ name: 'AUTRE', style: 'CARDIO', sets: [{ done: true }] }])], {});
  const row = r.comp && r.comp.exercises[0];
  assert.ok(!row || row.status === 'new' || row.status === 'na');
});

test('l\'écran de séance (liste ET focus) affiche la carte, et le récap la ligne « Distance : a→b »', () => {
  assert.equal((html.match(/<CardioDistanceCard /g) || []).length, 2, 'mode liste + mode focus');
  assert.match(html, /Distance : \{fmtDistanceM\(ex\.prevDist\)\}→/);
  assert.match(html, /\.\.\.\(setDistanceM\(s\)>0\?\{distance:setDistanceM\(s\)\}:\{\}\)/, 'enregistrement athlète');
});

let srv, coach, athleteId, athTok;
before(async () => {
  srv = await startServer();
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'dist@test.local', password: 'longenough1', firstName: 'Dist', lastName: 'T' } });
  const l = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'dist@test.local', password: 'longenough1' } });
  athTok = l.body.token; athleteId = l.body.user.id;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coach, body: { enabled: true } });
});
after(async () => { if (srv) await srv.stop(); });

test('serveur : la distance de chaque série cardio est conservée, bornée, et jamais ajoutée à un exercice de musculation', async () => {
  const body = { name: 'CARDIO', date: new Date().toISOString(), totalVolume: 0, exercises: [
    { name: 'SKIERG', muscle: 'CARDIO', style: 'CARDIO', cardio: { duree: "5'" }, sets: [{ weight: 0, reps: 0, done: true, distance: 1250 }, { weight: 0, reps: 0, done: true, distance: 99999999 }, { weight: 0, reps: 0, done: true, distance: 'abc' }] },
    { name: 'Squat', muscle: 'JAMBES', sets: [{ weight: 50, reps: 10, done: true, distance: 500 }] },
  ] };
  const post = await api(srv.baseUrl, 'POST', '/api/sessions', { token: athTok, body });
  assert.equal(post.status, 200);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athTok });
  const s = list.body.find(x => x.name === 'CARDIO');
  const skx = s.exercises.find(e => e.name === 'SKIERG'), sq = s.exercises.find(e => e.name === 'Squat');
  assert.deepEqual(skx.sets.map(x => x.distance), [1250, 100000, undefined]);
  assert.equal(sq.sets[0].distance, undefined, 'pas de distance sur une muscu');
});

test('serveur : une séance cardio créée/corrigée par le coach garde la distance', async () => {
  const body = { name: 'CARDIO COACH', date: new Date().toISOString(), exercises: [
    { name: 'SKIERG', muscle: 'CARDIO', style: 'CARDIO', groupType: 'cardio', cardio: { duree: "5'" }, sets: [{ weight: 0, reps: 0, distance: 1300 }] },
  ] };
  const post = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body });
  assert.equal(post.status, 200);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athTok });
  const s = list.body.find(x => x.name === 'CARDIO COACH');
  assert.equal(s.exercises[0].sets[0].distance, 1300);
  assert.equal(s.exercises[0].sets[0].done, true, 'une série avec distance compte comme faite');
});
