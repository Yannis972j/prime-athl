import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackStats, pendingFeedbackSessions, dayKeyTZ } from '../athlete-activity.js';

const TZ = 'America/Martinique'; // UTC-4
const NOW = Date.UTC(2026, 10, 8, 15, 0, 0); // 8 nov 11:00 à Fort-de-France
const iso = ms => new Date(ms).toISOString();
const H = 3600e3, D = 24 * H;
const S = (id, ms, extra = {}) => ({ id, name: 'Séance ' + id, date: iso(ms), ...extra });

test('dayKeyTZ : le jour est celui de Martinique, pas d\'UTC', () => {
  assert.equal(dayKeyTZ(Date.UTC(2026, 10, 9, 2, 0, 0), TZ), '2026-11-08'); // 02:00 UTC = 22:00 la veille
});
test('« aujourd\'hui » : séances du jour local, dernière heure retenue', () => {
  const r = feedbackStats([S('a', NOW - 2 * H), S('b', NOW - 1 * H), S('c', NOW - 20 * H)], { now: NOW, tz: TZ });
  assert.equal(r.todaySessionCount, 2);
  assert.equal(r.todayLastAt, iso(NOW - 1 * H));
});
test('une séance faite tard hier soir (UTC = aujourd\'hui) n\'est PAS « aujourd\'hui »', () => {
  const lateLastNight = Date.UTC(2026, 10, 8, 2, 30, 0); // 22:30 le 7 à Martinique
  assert.equal(feedbackStats([S('a', lateLastNight)], { now: NOW, tz: TZ }).todaySessionCount, 0);
});
test('« à commenter » : sans feedback, pas créée par le coach, dans les 14 jours', () => {
  const r = feedbackStats([
    S('ok', NOW - 1 * D, { coachFeedback: 'Bien' }),
    S('p1', NOW - 3 * D), S('p2', NOW - 1 * D),
    S('coach', NOW - 2 * D, { createdByCoach: true }),
    S('old', NOW - 20 * D),
    S('blank', NOW - 5 * D, { coachFeedback: '   ' }),
  ], { now: NOW, tz: TZ });
  assert.equal(r.pendingFeedbackCount, 3); // p1, p2, blank
  assert.equal(r.latestPendingSession.id, 'p2');
});
test('données invalides ignorées ; aucun athlète sans séance ne remonte', () => {
  const r = feedbackStats([{ id: 'x', date: 'nope' }, null, { id: 'y' }], { now: NOW, tz: TZ });
  assert.deepEqual(r, { todaySessionCount: 0, todayLastAt: null, pendingFeedbackCount: 0, latestPendingSession: null });
  assert.equal(feedbackStats(undefined, { now: NOW, tz: TZ }).pendingFeedbackCount, 0);
});

test('« ne pas commenter » : une séance écartée ne compte plus, mais reste visible dans « aujourd\'hui »', () => {
  const r = feedbackStats([S('a', NOW - 1 * H, { feedbackSkipped: true }), S('b', NOW - 2 * D)], { now: NOW, tz: TZ });
  assert.equal(r.pendingFeedbackCount, 1);
  assert.equal(r.latestPendingSession.id, 'b');
  assert.equal(r.todaySessionCount, 1);
});
test('un athlète avec 2 séances sans retour reste « à commenter » tant qu\'il en reste une', () => {
  const two = [S('a', NOW - 1 * D), S('b', NOW - 2 * D)];
  assert.equal(feedbackStats(two, { now: NOW, tz: TZ }).pendingFeedbackCount, 2);
  two[0].coachFeedback = 'Bien';
  assert.equal(feedbackStats(two, { now: NOW, tz: TZ }).pendingFeedbackCount, 1, 'il en reste une');
  two[1].feedbackSkipped = true;
  assert.equal(feedbackStats(two, { now: NOW, tz: TZ }).pendingFeedbackCount, 0, 'plus rien : disparaît de la liste');
});
test('pendingFeedbackSessions : mêmes règles que le compteur', () => {
  const l = pendingFeedbackSessions([S('a', NOW - D), S('b', NOW - D, { feedbackSkipped: true }), S('c', NOW - D, { coachFeedback: 'x' }), S('d', NOW - 30 * D)], { now: NOW });
  assert.deepEqual(l.map(x => x.id), ['a']);
});
