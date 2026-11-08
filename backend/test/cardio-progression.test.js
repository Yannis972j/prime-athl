// SKIERG RESISTANCE : objectif = moyenne + 50 m si la dernière série est ≥ 95 % de la 1re, sinon on consolide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/Muscu.html', import.meta.url), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const consts = html.match(/const CARDIO_PROG_STEP_M = 50, CARDIO_PROG_HOLD = 0\.95;/)[0];
const { isProgressiveCardio, cardioProgression } = new Function(`${extractFn('normExerciseName')}\n${consts}\n${extractFn('isProgressiveCardio')}\n${extractFn('cardioProgression')}\nreturn { isProgressiveCardio, cardioProgression };`)();

test('exemple : 200 · 200 · 200 → moyenne 200, 3e = 100 % de la 1re → objectif 250 m par série', () => {
  const p = cardioProgression([200, 200, 200]);
  assert.equal(p.avg, 200); assert.equal(p.pct, 100); assert.equal(p.ok, true); assert.equal(p.target, 250);
});
test('seuil de 95 % : 200 · 195 · 190 passe (95 %), 200 · 195 · 189 ne passe pas', () => {
  assert.equal(cardioProgression([200, 195, 190]).ok, true);
  assert.equal(cardioProgression([200, 195, 190]).target, 195 + 50);
  assert.equal(cardioProgression([200, 195, 189]).ok, false);
});
test('chute de la dernière série : pas de montée, l\'objectif reste la moyenne', () => {
  const p = cardioProgression([220, 200, 160]);
  assert.equal(p.avg, 193); assert.equal(p.ok, false); assert.equal(p.target, 193);
});
test('dernière série meilleure que la 1re : progresse', () => {
  assert.equal(cardioProgression([180, 190, 210]).ok, true);
});
test('moins de 2 séries renseignées : pas de règle ; les séries vides sont ignorées', () => {
  assert.equal(cardioProgression([300]), null);
  assert.equal(cardioProgression([]), null);
  assert.equal(cardioProgression([0, 0]), null);
  assert.equal(cardioProgression([200, 0, 200]).n, 2);
});
test('règle réservée à SKIERG RESISTANCE (pas aux sprints, pas aux autres cardios)', () => {
  assert.equal(isProgressiveCardio('SKIERG RESISTANCE '), true);
  assert.equal(isProgressiveCardio('Skierg résistance'), true);
  assert.equal(isProgressiveCardio('SKIERG SPRINTS 10 SEC A FOND'), false);
  assert.equal(isProgressiveCardio('SKIERG'), false);
  assert.equal(isProgressiveCardio('Tapis de course'), false);
});
