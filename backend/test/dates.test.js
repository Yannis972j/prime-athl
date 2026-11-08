// Dates invalides : jamais stockées (elles faisaient planter l'appli : « Invalid time value »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toValidDateMs, sessionDateISO, strictSessionDate, entryDateMs, validWeightKg, repairStoredDates } from '../dates.js';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

test('toValidDateMs : refuse le n\'importe quoi', () => {
  for (const v of ['pas une date', '', '   ', null, undefined, NaN, Infinity, {}, [], true, '1999-01-01', '2101-01-01', 'Invalid Date']) {
    assert.equal(toValidDateMs(v), null, String(v));
  }
});
test('toValidDateMs : accepte ISO, ms (nombre ou chaîne)', () => {
  assert.equal(toValidDateMs('2026-11-01T10:00:00.000Z'), Date.UTC(2026, 10, 1, 10));
  assert.equal(toValidDateMs(NOW), NOW);
  assert.equal(toValidDateMs(String(NOW)), NOW);
});
test('sessionDateISO : invalide ou futur → maintenant ; passé → conservé', () => {
  assert.equal(sessionDateISO('pas une date', NOW), new Date(NOW).toISOString());
  assert.equal(sessionDateISO(undefined, NOW), new Date(NOW).toISOString());
  assert.equal(sessionDateISO('2026-12-25T10:00:00Z', NOW), new Date(NOW).toISOString());
  assert.equal(sessionDateISO('2026-11-01T10:00:00Z', NOW), '2026-11-01T10:00:00.000Z');
  // tolérance fuseau : quelques heures d'avance restent acceptées
  assert.equal(sessionDateISO(new Date(NOW + 3600e3).toISOString(), NOW), new Date(NOW + 3600e3).toISOString());
});
test('strictSessionDate : 400-style pour invalide / futur, défaut = maintenant', () => {
  assert.deepEqual(strictSessionDate('xx', NOW), { ok: false, error: 'invalid_date' });
  assert.deepEqual(strictSessionDate('2027-01-01T00:00:00Z', NOW), { ok: false, error: 'date_in_future' });
  assert.equal(strictSessionDate(undefined, NOW).ok, true);
  assert.equal(strictSessionDate('2026-11-02T08:00:00Z', NOW).iso, '2026-11-02T08:00:00.000Z');
});
test('entryDateMs / validWeightKg', () => {
  assert.equal(entryDateMs('nope', 42), 42);
  assert.equal(entryDateMs(NOW - 1000, 42), NOW - 1000);
  assert.equal(validWeightKg('72,5'), 72.5);
  assert.equal(validWeightKg(0.5), null);
  assert.equal(validWeightKg(9999), null);
  assert.equal(validWeightKg('abc'), null);
});
test('repairStoredDates : répare séances / pesées / photos sans toucher aux valides', () => {
  const DATA = {
    sessions: {
      a: { id: 'a', date: 'garbage', createdAt: Date.UTC(2026, 9, 5) },
      b: { id: 'b', date: '2026-10-01T10:00:00.000Z' },
      c: { id: 'c', date: undefined },
    },
    weightLogs: { u: [{ weight: 70, date: 'x', createdAt: 1760000000000 }, { weight: 71, date: NOW }] },
    progressPhotos: { u: [{ date: null, createdAt: NOW }] },
  };
  const n = repairStoredDates(DATA, NOW);
  assert.equal(n, 4);
  assert.equal(DATA.sessions.a.date, '2026-10-05T00:00:00.000Z');
  assert.equal(DATA.sessions.b.date, '2026-10-01T10:00:00.000Z');
  assert.equal(DATA.sessions.c.date, new Date(NOW).toISOString());
  assert.equal(DATA.weightLogs.u[0].date, 1760000000000);
  assert.equal(DATA.weightLogs.u[1].date, NOW);
  assert.equal(DATA.progressPhotos.u[0].date, NOW);
  assert.equal(repairStoredDates(DATA, NOW), 0);
});
