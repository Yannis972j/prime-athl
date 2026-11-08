import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIVERSES, cleanUniverseAccess, universeOverride, applyUniverseChange } from '../universe-access.js';

test('cleanUniverseAccess : ne garde que les booléens des 4 univers', () => {
  assert.deepEqual(cleanUniverseAccess({ coach: true, ia: 'oui', foo: true, explorer: false, programmes: 1 }), { coach: true, explorer: false });
  assert.deepEqual(cleanUniverseAccess(null), {});
  assert.deepEqual(cleanUniverseAccess('x'), {});
});
test('universeOverride : undefined sans choix explicite, et pas de fuite via le prototype', () => {
  assert.equal(universeOverride({}, 'coach'), undefined);
  assert.equal(universeOverride({ universeAccess: { coach: false } }, 'coach'), false);
  assert.equal(universeOverride({ universeAccess: {} }, 'constructor'), undefined);
  assert.equal(universeOverride(null, 'coach'), undefined);
});
test('applyUniverseChange : un univers, tous, ou refus', () => {
  assert.deepEqual(applyUniverseChange({ ia: true }, { universe: 'coach', enabled: true }), { ia: true, coach: true });
  assert.deepEqual(applyUniverseChange({}, { all: true }), Object.fromEntries(UNIVERSES.map(k => [k, true])));
  assert.deepEqual(applyUniverseChange({ coach: true }, { all: false }), Object.fromEntries(UNIVERSES.map(k => [k, false])));
  for (const bad of [null, {}, { universe: 'x', enabled: true }, { universe: 'coach' }, { universe: 'coach', enabled: 'true' }, { universe: '__proto__', enabled: true }]) assert.equal(applyUniverseChange({}, bad), null, JSON.stringify(bad));
});
