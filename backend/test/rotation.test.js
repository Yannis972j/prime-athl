// Rotation de l'écran : un téléphone en PAYSAGE (largeur ≥ 768 px) doit rester en « mode mobile ».
// Sinon l'app bascule en mode ordinateur, l'arbre de l'interface est recréé et la séance en cours
// repart sur un autre exercice. computeIsMobile() vit dans le front : on l'extrait et on simule window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const computeIsMobile = (win) => new Function('window', `${extractFn('computeIsMobile')}\nreturn computeIsMobile();`)(win);
const dev = ({ w, h, sw, sh, coarse }) => ({
  innerWidth: w, innerHeight: h, screen: { width: sw ?? w, height: sh ?? h },
  matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? !!coarse : false }),
});

test('iPhone : portrait ET paysage restent en mode mobile (screen.* ne tourne pas sur iOS)', () => {
  assert.equal(computeIsMobile(dev({ w: 390, h: 844, sw: 390, sh: 844, coarse: true })), true);
  assert.equal(computeIsMobile(dev({ w: 844, h: 390, sw: 390, sh: 844, coarse: true })), true);   // paysage
  assert.equal(computeIsMobile(dev({ w: 932, h: 430, sw: 430, sh: 932, coarse: true })), true);   // Pro Max paysage
});

test('Android : portrait ET paysage restent en mode mobile (screen.* tourne avec l\'écran)', () => {
  assert.equal(computeIsMobile(dev({ w: 412, h: 915, coarse: true })), true);
  assert.equal(computeIsMobile(dev({ w: 915, h: 412, coarse: true })), true);                     // paysage
});

test('ordinateur : inchangé (mobile uniquement si fenêtre étroite)', () => {
  assert.equal(computeIsMobile(dev({ w: 1280, h: 800, coarse: false })), false);
  assert.equal(computeIsMobile(dev({ w: 600, h: 800, coarse: false })), true);
});

test('tablette : inchangé (petit côté ≥ 768 px → pas de mode mobile)', () => {
  assert.equal(computeIsMobile(dev({ w: 820, h: 1180, coarse: true })), false);
  assert.equal(computeIsMobile(dev({ w: 1180, h: 820, sw: 820, sh: 1180, coarse: true })), false);
});

test('API manquante (matchMedia / screen) : ne plante pas', () => {
  assert.equal(computeIsMobile({ innerWidth: 900, innerHeight: 400 }), false);
  assert.equal(computeIsMobile({ innerWidth: 500, innerHeight: 400 }), true);
});

test('l\'exercice courant est restauré depuis le snapshot local et sauvegardé à chaque changement', () => {
  assert.match(html, /useState\(\(\)=>\{\s*try\{\s*const s=JSON\.parse\(localStorage\.getItem\(SNAP_KEY\)[\s\S]{0,200}s\.currentEx/, 'init de currentEx depuis le snapshot');
  assert.match(html, /exercises,currentEx\}\)\)[\s\S]{0,40}\[exercises,currentEx\]/, 'currentEx sauvegardé dans le snapshot');
});
