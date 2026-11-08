import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validCatalogPriceCents } from '../catalog-price.js';

test('prix catalogue : gratuit ou 9,99–499 € (centimes)', () => {
  for (const ok of [0, undefined, null, '', 999, 1000, 2990, 49900, '2990']) assert.notEqual(validCatalogPriceCents(ok), null, String(ok));
  for (const bad of [1, 998, 49901, 100000, -500, 12.5, 'abc', NaN, Infinity, {}, [], true]) assert.equal(validCatalogPriceCents(bad), null, String(bad));
  assert.equal(validCatalogPriceCents(undefined), 0);
  assert.equal(validCatalogPriceCents(2990), 2990);
});
