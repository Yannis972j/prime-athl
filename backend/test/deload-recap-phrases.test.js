// Récap de décharge : diversité des félicitations (semaine / séance), du mindset et des explications « pourquoi une décharge ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
const a = html.indexOf('const DELOAD_WEEK_CONGRATS'), b = html.indexOf('];\n', html.indexOf('const DELOAD_WHY')) + 3;
assert.ok(a > 0 && b > a);
const { WEEK, SESSION, MINDSET, WHY } = new Function("const gg=(g,m,f)=>g==='f'?f:m;\n" + html.slice(a, b) +
  '\nreturn { WEEK: DELOAD_WEEK_CONGRATS, SESSION: DELOAD_SESSION_CONGRATS, MINDSET: DELOAD_MINDSET, WHY: DELOAD_WHY };')();
const run = (pool, g) => pool.map(v => (typeof v === 'function' ? v('Inaya', g) : v));

test('diversité : 4 félicitations semaine, 5 séance, 9 citations, 4 explications — toutes différentes', () => {
  assert.deepEqual([WEEK.length, SESSION.length, MINDSET.length, WHY.length], [4, 5, 9, 4]);
  for (const pool of [run(WEEK, 'f'), run(SESSION, 'f'), run(MINDSET.map(m => (typeof m === 'function' ? () => m('f') : m)), 'f'), WHY])
    assert.equal(new Set(pool).size, pool.length, 'aucun doublon');
});

test('félicitations : prénom présent, accords masculin / féminin, aucun résidu de gabarit', () => {
  const all = g => [...WEEK, ...SESSION].map(f => f('Inaya', g));
  for (const g of ['f', 'h', '']) for (const t of all(g)) { assert.match(t, /Inaya/); assert.doesNotMatch(t, /[{}]|undefined|\//); }
  const fem = all('f').join(' '), mas = all('h').join(' ');
  assert.match(fem, /sportives/); assert.match(fem, /fraîche/); assert.match(fem, /cuite/);
  assert.match(mas, /sportifs/); assert.match(mas, /frais\b/); assert.match(mas, /cuit\b/); assert.doesNotMatch(mas, /cuite|fraîche|sportives/);
});

test('mindset : valable pour une semaine ET une séance de décharge (pas de « cette semaine »)', () => {
  assert.doesNotMatch(MINDSET.map(m => (typeof m === 'function' ? m('f') : m)).join(' '), /cette semaine/i);
});

test('mindset : accord via le genre, rien de culpabilisant', () => {
  const fem = MINDSET.map(m => (typeof m === 'function' ? m('f') : m)).join(' ');
  assert.match(fem, /fraîche[\s\S]*forte/);
  assert.doesNotMatch(fem + WHY.join(' '), /paresse|faible|lâché|manque|honte|rat[ée]/i);
});

test('branchement : félicitations selon semaine/séance, ligne « pourquoi » pour l\'athlète seulement', () => {
  assert.match(html, /pick\(lightReason==='session'\?DELOAD_SESSION_CONGRATS:DELOAD_WEEK_CONGRATS\)/);
  assert.match(html, /const why = \(!coach && reason !== 'menstrual'\)/);
  assert.equal((html.match(/<DeloadRecapBanner[^>]*seed=/g) || []).length, 2, 'les 2 écrans athlète passent un seed');
});
