// Coach : la charge PRÉVUE de chaque exercice s'affiche dans « Séance prévue » et dans la carte du jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
const src = html.match(/function exWeightLabel\(ex\) \{[\s\S]*?\n\}\n/)[0];
const ctx = { exType: e => (e.style === 'CARDIO' ? 'cardio' : 'classic'), isAssistedEx: e => !!e.assisted };
vm.createContext(ctx); vm.runInContext(src + '\nthis.f = exWeightLabel;', ctx);
const f = ctx.f;

test('charge prévue : kg, fourchette, poids du corps, assisté, rien pour le cardio/gainage', () => {
  assert.equal(f({ style: 'CLASSIQUE', weightStr: '120' }), '120 kg');
  assert.equal(f({ style: 'CLASSIQUE', weightStr: '12,5-15' }), '12,5-15 kg');
  assert.equal(f({ style: 'CLASSIQUE', weightStr: '30 kg' }), '30 kg', 'pas de « kg kg »');
  assert.equal(f({ style: 'CLASSIQUE', weightStr: 'PDC' }), 'Poids du corps');
  assert.equal(f({ style: 'CLASSIQUE', weightStr: '2.5', assisted: true }), '2.5 kg (assist.)');
  assert.equal(f({ style: 'CLASSIQUE', weightStr: '', sets: [{ weight: 40 }] }), '40 kg', 'retombe sur la 1re série');
  assert.equal(f({ style: 'CLASSIQUE', weightStr: '', sets: [{ weight: 0 }] }), '');
  assert.equal(f({ style: 'CARDIO', weightStr: '5' }), '');
  assert.equal(f({ style: 'CLASSIQUE', holdSeconds: 60, weightStr: '10' }), '');
});

test('affichage : présent dans la fenêtre « Séance prévue » et la carte du jour', () => {
  assert.match(html, /data-testid="day-ex-weight"[^>]*>\{exWeightLabel\(e\)\}/);
  assert.match(html, /\{plannedVolumeLabel\(ex\)\}\{exWeightLabel\(ex\)&&/);
});
