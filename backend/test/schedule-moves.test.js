// Déplacer une séance sur un jour occupé l'ÉCHANGE avec l'occupant (rien n'est effacé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, cancelMove } from '../schedule-moves.js';

const DAYS = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const dayOf = ds => DAYS[new Date(ds + 'T12:00:00').getDay()];
const MON = '2026-11-02', TUE = '2026-11-03', WED = '2026-11-04', THU = '2026-11-05';
const dayNames = new Set(['LUNDI', 'MARDI']); // séances A (lundi) et B (mardi)
const mv = (moves, o) => applyMove(moves, { dayNames, dayOf, ...o });
const strip = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, `${v.sourceDayName}@${v.sourceDate}`]));

test('jour libre : simple déplacement', () => {
  const m = {};
  assert.deepEqual(mv(m, { fromDate: MON, toDate: WED }), { ok: true, swapped: false });
  assert.deepEqual(strip(m), { [WED]: `LUNDI@${MON}` });
});
test('jour occupé sans force : 409 target_occupied, rien ne change', () => {
  const m = {};
  assert.equal(mv(m, { fromDate: MON, toDate: TUE }).error, 'target_occupied');
  assert.deepEqual(m, {});
});
test('jour occupé avec force : ÉCHANGE (les deux séances survivent)', () => {
  const m = {};
  const r = mv(m, { fromDate: MON, toDate: TUE, force: true });
  assert.equal(r.swapped, true);
  assert.deepEqual(strip(m), { [TUE]: `LUNDI@${MON}`, [MON]: `MARDI@${TUE}` });
});
test('ré-échanger remet tout au naturel', () => {
  const m = {};
  mv(m, { fromDate: MON, toDate: TUE, force: true });
  mv(m, { fromDate: MON, toDate: TUE, force: true });
  assert.deepEqual(m, {});
});
test('cible = séance déjà déplacée là : échange aussi', () => {
  const m = {};
  mv(m, { fromDate: MON, toDate: WED });                 // A → mercredi
  mv(m, { fromDate: TUE, toDate: WED, force: true });    // B ↔ A
  assert.deepEqual(strip(m), { [WED]: `MARDI@${TUE}`, [TUE]: `LUNDI@${MON}` });
});
test('annuler un échange rétablit les deux jours', () => {
  const m = {};
  mv(m, { fromDate: MON, toDate: TUE, force: true });
  assert.deepEqual(cancelMove(m, TUE), { ok: true });
  assert.deepEqual(m, {});
  mv(m, { fromDate: MON, toDate: TUE, force: true });
  cancelMove(m, MON);
  assert.deepEqual(m, {});
});
test('annuler un simple déplacement ; date sans déplacement → not_found', () => {
  const m = {};
  mv(m, { fromDate: MON, toDate: WED });
  assert.deepEqual(cancelMove(m, WED), { ok: true });
  assert.deepEqual(m, {});
  assert.equal(cancelMove(m, THU).error, 'not_found');
});
test('jour sans séance : no_session_on_date', () => {
  assert.equal(mv({}, { fromDate: WED, toDate: THU }).error, 'no_session_on_date');
});
test('invariant : le nombre de séances prévues ne change jamais', () => {
  const count = m => { const moved = new Set(Object.values(m).map(x => x.sourceDate)); return Object.keys(m).length + ['2026-11-02', '2026-11-03'].filter(d => !moved.has(d)).length; };
  const m = {};
  for (const [f, t] of [[MON, TUE], [MON, WED], [TUE, WED], [WED, THU], [THU, MON]]) { mv(m, { fromDate: f, toDate: t, force: true }); assert.equal(count(m), 2, `${f}→${t}`); }
});
