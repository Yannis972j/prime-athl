// Tests de la comparaison entre deux séances (récap « vs dernière fois »).
// buildSessionComparison vit dans le front (Muscu.html, JS pur sans JSX) : on en extrait le code
// source avec ses petites dépendances et on l'exécute ici, sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');

// Extrait `function name(...) { ... }` en comptant les accolades.
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fonction ${name} introuvable dans Muscu.html`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}
const names = ['normExerciseName', 'isUnilateralName', 'isUnilateralEx', 'isAssistedName', 'isAssistedEx', 'sessionVolumeOf', 'buildSessionComparison'];
const build = new Function(`${names.map(extractFn).join('\n')}\nreturn buildSessionComparison;`)();

const S = (weight, reps) => ({ weight, reps, done: true });
const ex = (name, sets, extra = {}) => ({ name, sets, ...extra });
const sess = (id, date, exercises, extra = {}) => ({ id, name: 'PULL', date, exercises, ...extra });
const P = '2026-10-01T10:00:00Z', C = '2026-10-08T10:00:00Z';
const compare = (prevEx, curEx, prevExtra = {}) => build(sess('c', C, curEx), [sess('p', P, prevEx, prevExtra)], {});

test('exercice présent deux fois : chaque occurrence se compare à la sienne', () => {
  const { comp } = compare([ex('Curl', [S(20, 10)]), ex('Curl', [S(10, 10)])], [ex('Curl', [S(25, 10)]), ex('Curl', [S(10, 10)])]);
  assert.equal(comp.exercises[0].vDelta, 50);
  assert.equal(comp.exercises[0].wDelta, 5);
  assert.equal(comp.exercises[1].status, 'same');
});

test('mêmes exercices avec postures entre parenthèses différentes : aucun faux écart', () => {
  const rows = [ex('Squat (pieds serrés)', [S(100, 5)]), ex('Squat (pieds écartés)', [S(60, 10)])];
  const { comp } = compare(rows, rows);
  assert.deepEqual(comp.exercises.map(e => e.status), ['same', 'same']);
  assert.equal(comp.downCount, 0);
});

test('exercice assisté : moins d\'assistance = progrès (et PR), plus d\'assistance = recul', () => {
  const a = (w) => [ex('Tractions assistées', [S(w, 8), S(w, 8)], { assisted: true })];
  const better = compare(a(40), a(30)).comp;
  assert.equal(better.exercises[0].status, 'up');
  assert.equal(better.exercises[0].isPR, true);
  assert.equal(better.exercises[0].vDelta, 0, 'pas d\'écart de volume affiché pour un assisté');
  const worse = compare(a(30), a(40)).comp;
  assert.equal(worse.exercises[0].status, 'down');
  assert.equal(worse.exercises[0].isPR, false);
  assert.equal(better.exercises[0].curE1RM, 0, 'pas de 1RM estimé pour un assisté');
  assert.equal(better.overloadCount, 0, 'jamais « monter la charge » sur un assisté');
});

test('poids du corps : progression mesurée sur les répétitions', () => {
  const { comp } = compare([ex('Pompes', [S(0, 10), S(0, 10)])], [ex('Pompes', [S(0, 15), S(0, 15)])]);
  assert.equal(comp.exercises[0].kind, 'bodyweight');
  assert.equal(comp.exercises[0].status, 'up');
  assert.equal(comp.upCount, 1);
});

test('gainage : progression mesurée sur la durée de maintien', () => {
  const g = (sec) => [ex('Gainage', [{ weight: 0, reps: 0, done: true }], { holdSeconds: sec })];
  assert.equal(compare(g(45), g(60)).comp.exercises[0].status, 'up');
  assert.equal(compare(g(60), g(45)).comp.exercises[0].status, 'down');
  assert.equal(compare(g(45), g(45)).comp.exercises[0].status, 'same');
});

test('gainage tel qu\'enregistré (séries sans `done`, 0 kg / 0 reps) : compté, pas de « 1→0 série »', () => {
  const g = (sec) => [ex('Gainage', [{ weight: 0, reps: 0 }, { weight: 0, reps: 0 }], { holdSeconds: sec })];
  const { comp } = compare(g(45), g(60));
  assert.equal(comp.exercises[0].curSets, 2);
  assert.equal(comp.exercises[0].prevSets, 2);
  assert.equal(comp.exercises[0].status, 'up');
});

test('cardio : non compté (ni hausse, ni stable, ni dénominateur)', () => {
  const tapis = ex('Tapis de course', [{ weight: 0, reps: 0, done: true }], { style: 'CARDIO' });
  const { comp } = compare([ex('Rowing', [S(100, 10)]), tapis], [ex('Rowing', [S(100, 12)]), tapis]);
  assert.equal(comp.exercises[1].status, 'na');
  assert.equal(comp.sameCount, 0);
  assert.equal(comp.totalExercises, 1);
  assert.equal(comp.upCount, 1);
});

test('séance précédente vide (seul le cardio conservé) : pas de référence → première séance', () => {
  const tapis = ex('Tapis de course', [{ weight: 0, reps: 0, done: true }], { style: 'CARDIO' });
  const { comp, volumeVsPrev } = compare([tapis], [ex('Squat', [S(120, 7)]), tapis]);
  assert.equal(comp, null);
  assert.equal(volumeVsPrev, null);
});

test('référence : saute une séance vide et prend la dernière avec du vrai travail', () => {
  const empty = sess('e', '2026-10-05T10:00:00Z', [ex('Tapis de course', [{ weight: 0, reps: 0, done: true }], { style: 'CARDIO' })]);
  const real = sess('r', P, [ex('Squat', [S(100, 10)])]);
  const { comp } = build(sess('c', C, [ex('Squat', [S(110, 10)])]), [empty, real], {});
  assert.equal(comp.exercises[0].status, 'up');
  assert.equal(comp.exercises[0].prevMaxW, 100);
});

test('noms d\'exercices tous différents : aucun exercice « comparé » → pas de faux « même niveau »', () => {
  const { comp, volumeVsPrev } = compare([ex('Squat', [S(110, 8)])], [ex('Squat barre', [S(120, 7)])]);
  assert.equal(comp.totalExercises, 0, 'le message ne doit pas se déclencher sur 0 exercice comparé');
  assert.equal(comp.newCount, 1);
  assert.ok(volumeVsPrev.previous > 0);
});

test('musculation classique inchangée : hausse / baisse / PR / surcharge', () => {
  const { comp } = compare(
    [ex('Rowing', [S(100, 10)]), ex('Curl', [S(30, 10)])],
    [ex('Rowing', [S(105, 10)]), ex('Curl', [S(25, 10)])]);
  assert.equal(comp.exercises[0].status, 'up');
  assert.equal(comp.exercises[0].isPR, true);
  assert.equal(comp.exercises[1].status, 'down');
  assert.equal(comp.prsCount, 1);
  assert.equal(comp.totalExercises, 2);
});

test('une décharge n\'est jamais la référence', () => {
  const deload = sess('d', '2026-10-05T10:00:00Z', [ex('Rowing', [S(50, 10)])], { deload: true });
  const { comp } = build(sess('c', C, [ex('Rowing', [S(100, 10)])]), [deload], {});
  assert.equal(comp, null);
});

test('ressenti saisi par série : remonté dans chaque ligne du récap (n° de série + texte)', () => {
  const withNote = (w, r, note) => ({ weight: w, reps: r, done: true, ...(note ? { note } : {}) });
  const { comp } = compare(
    [ex('Squat', [S(100, 5), S(100, 5), S(100, 5)])],
    [ex('Squat', [withNote(105, 5, 'Genou tire'), S(105, 5), withNote(105, 4, 'Trop dur')])]);
  assert.deepEqual(comp.exercises[0].setNotes, [{ n: 1, t: 'Genou tire' }, { n: 3, t: 'Trop dur' }]);
  // aussi sur un exercice nouveau (sans équivalent précédent)
  const fresh = compare([ex('Rowing', [S(50, 10)])], [ex('Curl', [withNote(20, 10, 'Super')])]).comp;
  assert.deepEqual(fresh.exercises[0].setNotes, [{ n: 1, t: 'Super' }]);
  // pas de ressenti → tableau vide
  assert.deepEqual(compare([ex('Squat', [S(100, 5)])], [ex('Squat', [S(100, 5)])]).comp.exercises[0].setNotes, []);
});

test('front : le ressenti s\'affiche dans les 4 récaps + l\'onglet Séance du coach, et le menu déroulant feedback survit au rechargement', () => {
  assert.equal((html.match(/<RecapSetNotes notes=\{ex\.setNotes\}\/>/g) || []).length, 4);
  assert.match(html, /function RecapSetNotes\(/);
  assert.match(html, /\{st\.note&&<div data-testid="recap-ressenti"/);
  assert.match(html, /const sessionFeedbackBanner=React\.useMemo\(/);
  assert.match(html, /coachFeedback=\{coachSessionTarget\?null:sessionFeedbackBanner\}/);
});
