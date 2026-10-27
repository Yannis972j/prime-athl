// Notifications : planification de la motivation quotidienne + service worker (affichage des push).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { zonedParts, shouldSendMotivation } from '../motivation.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('motivation : envoyée dès 5 h (Martinique) une seule fois par jour', () => {
  // 05:00 à Martinique (UTC-4) = 09:00 UTC
  const p = zonedParts(new Date('2026-10-27T09:00:00Z'));
  assert.deepEqual([p.dateStr, p.hour, p.minute], ['2026-10-27', 5, 0]);
  assert.equal(shouldSendMotivation(p, null), true);
  assert.equal(shouldSendMotivation(p, '2026-10-27'), false, 'déjà envoyée aujourd\'hui');
  assert.equal(shouldSendMotivation(p, '2026-10-26'), true, 'envoyée hier seulement');
});

test('motivation : un tick manqué à 5 h 00 est rattrapé (le bug de dérive du setInterval)', () => {
  // L'ancien code exigeait minute === 0 : un tick à 05:01:00 (dérive) n'envoyait JAMAIS.
  for (const iso of ['2026-10-27T09:01:00Z', '2026-10-27T09:37:00Z', '2026-10-27T12:00:00Z', '2026-10-27T13:59:00Z']) {
    assert.equal(shouldSendMotivation(zonedParts(new Date(iso)), null), true, iso);
  }
});

test('motivation : jamais avant 5 h, ni après la fenêtre de rattrapage (10 h)', () => {
  assert.equal(shouldSendMotivation(zonedParts(new Date('2026-10-27T08:59:00Z')), null), false, '04:59 Martinique');
  assert.equal(shouldSendMotivation(zonedParts(new Date('2026-10-27T14:00:00Z')), null), false, '10:00 Martinique');
  assert.equal(shouldSendMotivation(zonedParts(new Date('2026-10-27T20:00:00Z')), null), false, '16:00 Martinique');
});

test('motivation : redémarrage serveur dans la fenêtre → pas de double envoi (date persistée)', () => {
  const p = zonedParts(new Date('2026-10-27T11:30:00Z')); // 07:30 Martinique
  assert.equal(shouldSendMotivation(p, '2026-10-27'), false);
});

test('motivation : minuit à Martinique (changement de jour) = jour suivant', () => {
  const p = zonedParts(new Date('2026-10-28T04:30:00Z')); // 00:30 le 28 à Martinique
  assert.equal(p.dateStr, '2026-10-28');
  assert.equal(p.hour, 0);
  assert.equal(shouldSendMotivation(p, '2026-10-27'), false, 'pas avant 5 h');
});

// ── service worker : chaque notification doit rester visible (tag unique) ──
function runPush(payload) {
  const src = fs.readFileSync(path.join(here, '../public/sw.js'), 'utf8');
  const shown = [];
  const listeners = {};
  const self = {
    addEventListener: (n, fn) => { listeners[n] = fn; },
    registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve() },
    skipWaiting() {}, location: { origin: 'http://x' },
  };
  const ctx = vm.createContext({ self, caches: { open: () => Promise.resolve({ addAll() {}, put() {} }), keys: () => Promise.resolve([]), match: () => Promise.resolve(null), delete: () => Promise.resolve() }, fetch: () => Promise.resolve({}), URL, Promise, console, setTimeout, Date, Math, JSON, clients: self.clients });
  vm.runInContext(src, ctx);
  listeners.push({ data: { text: () => JSON.stringify(payload) }, waitUntil: p => p });
  return shown[0];
}

test('service worker : deux notifications différentes n\'ont pas le même tag (aucune n\'écrase l\'autre)', () => {
  const a = runPush({ title: '💬 Feedback de Yannis', body: 'a' });
  const b = runPush({ title: '📚 Bibliothèque mise à jour', body: 'b' });
  assert.ok(a.opts.tag && b.opts.tag);
  assert.notEqual(a.opts.tag, b.opts.tag);
  assert.equal(a.title, '💬 Feedback de Yannis');
  assert.equal(a.opts.data.url, '/Muscu.html');
});

test('service worker : un tag imposé par le serveur (messages d\'une conversation) est respecté', () => {
  const m = runPush({ title: '💬 Coach', body: 'salut', tag: 'msg-123' });
  assert.equal(m.opts.tag, 'msg-123');
});

// ── rappels d'expiration d'accès J-3/J-2/J-1 (push) ──
import { accessDaysLeft, dueAccessReminders, accessReminderPayload, isAccessExpiredFor, staleFullAccessExpiries } from '../access-reminders.js';
const NOW = new Date('2026-10-28T09:00:00Z').getTime();
const inDays = (n, h = 0) => new Date(NOW + n * 86400000 + h * 3600000).toISOString();
const ath = (over) => ({ id: 'u1', role: 'athlete', status: 'active', ...over });

test('accès : rappel à J-3, J-2 et J-1 seulement, pas avant, pas après', () => {
  for (const [exp, palier] of [[inDays(3), 3], [inDays(2), 2], [inDays(1), 1], [inDays(0, 5), 1]]) {
    const due = dueAccessReminders({ u1: ath({ accessExpiresAt: exp }) }, NOW);
    assert.deepEqual(due.map(d => d.palier), [palier], exp);
  }
  assert.deepEqual(dueAccessReminders({ u1: ath({ accessExpiresAt: inDays(4) }) }, NOW), [], 'J-4 : trop tôt');
  assert.deepEqual(dueAccessReminders({ u1: ath({ accessExpiresAt: inDays(-1) }) }, NOW), [], 'déjà expiré : pas de rappel');
});

test('accès : exemptés = coach, accès illimité, compte inactif — PAS l\'accès complet (Kenji : « accès complet jusqu\'au 1er nov. »)', () => {
  const exp = inDays(2);
  const users = {
    a: ath({ id: 'a', accessExpiresAt: exp, role: 'coach' }),
    b: ath({ id: 'b', accessExpiresAt: exp, fullAccess: true }),
    c: ath({ id: 'c', accessExpiresAt: null }),
    d: ath({ id: 'd', accessExpiresAt: exp, status: 'pending' }),
    e: ath({ id: 'e', accessExpiresAt: exp }),
  };
  // l'accès complet reçoit bien le rappel (la durée s'applique toujours)
  assert.deepEqual(dueAccessReminders(users, NOW).map(d => d.userId).sort(), ['b', 'e']);
});

test('accès complet + date de fin : bloqué à la date (avant il ne l\'était jamais)', () => {
  const kenji = { role: 'athlete', email: 'k@x', fullAccess: true, accessExpiresAt: inDays(6) };
  assert.equal(isAccessExpiredFor(kenji, NOW), false, '6 jours restants : accès actif');
  assert.equal(isAccessExpiredFor(kenji, NOW + 6 * 86400000 + 1000), true, 'après le 1er nov. : bloqué');
  assert.equal(isAccessExpiredFor({ ...kenji, fullAccess: false }, NOW + 7 * 86400000), true, 'sans accès complet : idem');
  assert.equal(isAccessExpiredFor({ ...kenji, accessExpiresAt: null }, NOW + 999 * 86400000), false, 'illimité');
  assert.equal(isAccessExpiredFor({ ...kenji, role: 'coach' }, NOW + 999 * 86400000), false, 'coach exempté');
  assert.equal(isAccessExpiredFor({ ...kenji, email: 'boss@x' }, NOW + 999 * 86400000, 'boss@x'), false, 'coach principal exempté');
});

test('migration : les dates DÉJÀ dépassées en accès complet sont repérées (pour ne bloquer personne au déploiement), pas les futures', () => {
  const users = {
    past: { id: 'past', role: 'athlete', fullAccess: true, accessExpiresAt: inDays(-3) },
    future: { id: 'future', role: 'athlete', fullAccess: true, accessExpiresAt: inDays(6) },
    noFull: { id: 'noFull', role: 'athlete', fullAccess: false, accessExpiresAt: inDays(-3) },
    unlimited: { id: 'unlimited', role: 'athlete', fullAccess: true, accessExpiresAt: null },
    coach: { id: 'coach', role: 'coach', fullAccess: true, accessExpiresAt: inDays(-3) },
  };
  assert.deepEqual(staleFullAccessExpiries(users, NOW), ['past']);
});

test('accès : un palier n\'est rappelé qu\'une fois ; une prolongation remet les paliers à zéro', () => {
  const exp = inDays(2);
  const sent = ath({ accessExpiresAt: exp, accessReminded: { 2: exp } });
  assert.deepEqual(dueAccessReminders({ u1: sent }, NOW), [], 'déjà rappelé');
  // le coach prolonge puis on retombe à J-2 sur une NOUVELLE date → nouveau rappel
  const extended = { ...sent, accessExpiresAt: inDays(2, 3) };
  assert.equal(dueAccessReminders({ u1: extended }, NOW).length, 1);
});

test('accès : texte de la notification', () => {
  assert.equal(accessReminderPayload(3, 'Yannis').title, '⏳ Ton accès se termine dans 3 jours');
  assert.equal(accessReminderPayload(1, 'Yannis').title, '⏳ Ton accès se termine dans moins de 24 h');
  assert.match(accessReminderPayload(2, 'Yannis').body, /Yannis peut le prolonger/);
  assert.equal(accessDaysLeft({ role: 'athlete', accessExpiresAt: inDays(2, 1) }, NOW), 3, 'arrondi au supérieur, comme le pop-up');
});
