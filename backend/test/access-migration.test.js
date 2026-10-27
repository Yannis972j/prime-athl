// Démarrage du serveur avec une base existante : la migration efface les dates de fin DÉJÀ dépassées des
// athlètes en accès complet (jamais bloqués jusqu'ici) et laisse intactes les dates futures. Garde aussi
// contre un crash au boot (persist() appelé avant l'initialisation de ses variables).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer } from './helpers/server.js';

test('boot : migration des dates périmées en accès complet, sans crash', async () => {
  const day = 86400000, now = Date.now();
  const mk = (id, extra) => ({ id, email: id + '@t.local', role: 'athlete', status: 'active', firstName: id, passwordHash: '$2a$12$x', createdAt: now, ...extra });
  const db = path.join(os.tmpdir(), `pa-migr-${crypto.randomUUID()}.json`);
  fs.writeFileSync(db, JSON.stringify({ users: {
    past: mk('past', { fullAccess: true, accessExpiresAt: new Date(now - 3 * day).toISOString() }),
    kenji: mk('kenji', { fullAccess: true, accessExpiresAt: new Date(now + 6 * day).toISOString() }),
    nofull: mk('nofull', { fullAccess: false, accessExpiresAt: new Date(now - 3 * day).toISOString() }),
  } }));
  const srv = await startServer({ DB_PATH: db }); // échoue si le serveur plante au démarrage
  try {
    await new Promise(r => setTimeout(r, 800)); // laisse le flush (debounce) se faire
    const users = JSON.parse(fs.readFileSync(db, 'utf8')).users;
    assert.equal(users.past.accessExpiresAt, null, 'date périmée + accès complet : effacée (accès illimité conservé)');
    assert.ok(users.kenji.accessExpiresAt, 'date future + accès complet : conservée (elle s\'applique maintenant)');
    assert.ok(users.nofull.accessExpiresAt, 'sans accès complet : inchangé');
  } finally { await srv.stop(); }
});
