// Import Excel : une ligne au style CARDIO (SKIERG, rameur…) doit rester du CARDIO même avec une Durée.
// Régression : toute ligne avec une Durée devenait un compte à rebours (gainage) — seul le tapis y
// échappait — donc « SKIERG / CARDIO / 5' » n'apparaissait pas en cardio et « 5' » était lu 5 SECONDES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');

const dep = name => {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; if (html[j] === '}') { d--; if (!d) break; } }
  return html.slice(i, j + 1) + '\n';
};
const HELPERS = ['fixCardioVal', 'cardioHasVal', 'fixCardioDuree', 'cardioDureeLabel', 'cardioShowsSpeed',
  'parseRestDuration', 'isHoldExercise', 'fmtHoldDuration', 'isUnilateralName', 'isAssistedName', 'isSideHoldEx'].map(dep).join('');
const a = html.indexOf('function parseDureeSeconds');
const b = html.indexOf('function excelExport');
const factory = new Function('XLSX', 'FileReader', HELPERS + html.slice(a, b) + '\nreturn { parseYannisExcel, cardioDureeLabel, cardioShowsSpeed };');

const HEAD = ['Jour', 'Style', 'Exercices', 'Muscles', 'Charge KG', 'Distance km', 'Vitesse', 'Inclinaison', 'Durée', 'Series', 'Repetions', 'Temps de repos'];
const row = (o) => HEAD.map((h, i) => o[i] ?? '');
function parse(rows) {
  const ws = XLSX.utils.aoa_to_sheet([['SEANCE TEST'], HEAD, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'T');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  class FR { readAsArrayBuffer() { setTimeout(() => this.onload({ target: { result: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } }), 0); } }
  const { parseYannisExcel } = factory(XLSX, FR);
  return new Promise((res, rej) => parseYannisExcel({}, (p, w, lib) => res(lib[0].exercises), rej, {}));
}

test('SKIERG en CARDIO avec une durée : vrai cardio (pas un compte à rebours), 1 série, durée conservée', async () => {
  const ex = await parse([[ '', 'CARDIO', 'SKIERG', 'CARDIO', '', '', '', '', "5'" ]]);
  assert.equal(ex[0].style, 'CARDIO');
  assert.deepEqual(ex[0].cardio, { distance: '', vitesse: '', inclinaison: '', duree: "5'" });
  assert.equal(ex[0].holdSeconds, 0);
  assert.equal(ex[0].sets.length, 1);
});

test('cardio par intervalles : le nombre de séries du tableau est respecté (3 × 10")', async () => {
  const ex = await parse([[ '', 'CARDIO', 'SKIERG SPRINTS', 'CARDIO', '', '', '', '', '10"', 3, '', "1'" ]]);
  assert.equal(ex[0].cardio.duree, '10"');
  assert.equal(ex[0].sets.length, 3);
  assert.equal(ex[0].restSeconds, 60);
});

test('inchangé : un gainage (durée, style classique) reste un compte à rebours en secondes', async () => {
  const ex = await parse([[ '', 'CLASSIQUE', 'GAINAGE PLANCHE', 'ABDOS', '', '', '', '', "45'", 3, '', "1'" ]]);
  assert.equal(ex[0].cardio, null);
  assert.equal(ex[0].holdSeconds, 45);
  assert.equal(ex[0].sets.length, 3);
});

test('affichage : minutes pour 5\' / 2\', secondes pour 10" ; vitesse/inclinaison seulement pour un tapis', () => {
  const { cardioDureeLabel, cardioShowsSpeed } = factory(XLSX, class {});
  assert.equal(cardioDureeLabel("5'"), '5 min');
  assert.equal(cardioDureeLabel('2'), '2 min');
  assert.equal(cardioDureeLabel('10"'), '10 s');
  assert.equal(cardioDureeLabel('10 sec'), '10 s');
  assert.equal(cardioShowsSpeed({ name: 'TAPIS DE COURSE', cardio: {} }), true);
  assert.equal(cardioShowsSpeed({ name: 'SKIERG', cardio: { duree: "5'" } }), false);
  assert.equal(cardioShowsSpeed({ name: 'VELO', cardio: { vitesse: '25' } }), true);
});
