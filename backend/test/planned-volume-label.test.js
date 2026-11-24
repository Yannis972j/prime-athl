// Listes de séances PRÉVUES : un cardio affiche sa durée (« 30 min »), sa distance, ou « Cardio » — jamais
// « 1 × 10 » (10 = répétitions par défaut de l'import). Musculation et gainage inchangés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
const dep = name => {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; if (html[j] === '}') { d--; if (!d) break; } }
  return html.slice(i, j + 1) + '\n';
};
const src = ['fixCardioVal', 'cardioHasVal', 'fixCardioDuree', 'cardioDureeLabel', 'fmtHoldDuration', 'isSideHoldEx', 'seriesCount', 'seriesLabel', 'plannedVolumeLabel'].map(dep).join('');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src + '\nthis.f = plannedVolumeLabel;', ctx);
const f = ctx.f;
const sets = (n, o = {}) => Array.from({ length: n }, () => ({ target: 10, ...o }));

test('cardio : durée, minutes/secondes, distance, sinon « Cardio » — jamais « 1 × 10 »', () => {
  assert.equal(f({ style: 'CARDIO', cardio: { duree: "30'" }, sets: sets(1) }), '30 min');
  assert.equal(f({ style: 'CARDIO', cardio: { duree: '20' }, sets: sets(1) }), '20 min');
  assert.equal(f({ style: 'CARDIO', cardio: { duree: '10"' }, sets: sets(1) }), '10 s');
  assert.equal(f({ style: 'CARDIO', cardio: { duree: "5'" }, sets: sets(6) }), '6× 5 min', 'intervalles : séries × durée');
  assert.equal(f({ style: 'CARDIO', cardio: { duree: '', distance: '3' }, sets: sets(1) }), '3 km');
  assert.equal(f({ style: 'CARDIO', cardio: { duree: '', distance: '' }, sets: sets(1) }), 'Cardio');
  assert.equal(f({ groupType: 'cardio', cardio: { duree: "45'" }, sets: sets(1) }), '45 min', 'exercice cardio créé dans l\'app');
  assert.equal(f({ style: 'CARDIO', sets: sets(1) }), 'Cardio', 'sans objet cardio');
  assert.doesNotMatch(f({ style: 'CARDIO', cardio: { duree: "30'" }, sets: sets(1) }), /×\s*10/);
});

test('musculation et gainage inchangés', () => {
  assert.equal(f({ style: 'CLASSIQUE', repsStr: '8-10', sets: sets(4) }), '4×8-10');
  assert.equal(f({ style: 'CLASSIQUE', sets: [{ target: 12 }, { target: 12 }] }), '2×12');
  assert.equal(f({ style: 'CLASSIQUE', sets: sets(3, { target: undefined, targetStr: undefined }) }), '3');
  assert.equal(f({ style: 'CLASSIQUE', holdSeconds: 45, sets: sets(3) }), '3×45s');
  assert.equal(f({ style: 'CLASSIQUE', holdSeconds: 30, sideHold: true, sets: sets(2) }), '2×30s/côté');
});

test('toutes les listes de séances prévues passent par ce libellé', () => {
  const uses = html.match(/plannedVolumeLabel\(/g).length;
  assert.ok(uses >= 9, 'helper utilisé partout (' + uses + ')');
  assert.doesNotMatch(html, /\{nSets\|\|'\?'\}\{reps\?' × '\+reps:''\}/, 'ancien « 1 × 10 » de la fenêtre Séance prévue');
});
