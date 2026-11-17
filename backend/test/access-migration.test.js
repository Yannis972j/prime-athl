// Démarrage / redémarrage du serveur avec une base existante : une date de fin d'accès dépassée doit
// RESTER en place — y compris pour un athlète en accès complet. (Une ancienne migration l'effaçait à
// chaque démarrage : après un redémarrage, l'accès expiré redevenait illimité, sans aucun blocage.)
// Garde aussi contre un crash au boot (persist() appelé avant l'initialisation de ses variables).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { startServer, api } from './helpers/server.js';

test('boot : les dates de fin dépassées sont conservées après (re)démarrage, l\'athlète reste bloqué', async () => {
  const day = 86400000, now = Date.now(), PW = 'longenough1';
  const hash = await bcrypt.hash(PW, 4);
  const mk = (id, extra) => ({ id, email: id + '@t.local', role: 'athlete', status: 'active', firstName: id, passwordHash: hash, createdAt: now, ...extra });
  const past = new Date(now - 3 * day).toISOString(), future = new Date(now + 6 * day).toISOString();
  const db = path.join(os.tmpdir(), `pa-migr-${crypto.randomUUID()}.json`);
  fs.writeFileSync(db, JSON.stringify({ users: {
    past: mk('past', { fullAccess: true, accessExpiresAt: past }),
    kenji: mk('kenji', { fullAccess: true, accessExpiresAt: future }),
    nofull: mk('nofull', { fullAccess: false, accessExpiresAt: past }),
  } }));
  const readUsers = () => JSON.parse(fs.readFileSync(db, 'utf8')).users;
  // Deux démarrages d'affilée sur la même base (= un redémarrage / redéploiement).
  for (let boot = 1; boot <= 2; boot++) {
    const srv = await startServer({ DB_PATH: db }); // échoue si le serveur plante au démarrage
    try {
      await new Promise(r => setTimeout(r, 800)); // laisse le flush (debounce) se faire
      const users = readUsers();
      assert.equal(users.past.accessExpiresAt, past, `démarrage ${boot} : date périmée + accès complet CONSERVÉE`);
      assert.equal(users.kenji.accessExpiresAt, future, `démarrage ${boot} : date future conservée`);
      assert.equal(users.nofull.accessExpiresAt, past, `démarrage ${boot} : sans accès complet : inchangé`);
      if (boot === 2) {
        // Côté serveur, l'athlète en accès complet dont la durée est écoulée est bien refusé en écriture.
        const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'past@t.local', password: PW } });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.accessExpiresAt, past);
        const w = await api(srv.baseUrl, 'POST', '/api/sessions', { token: login.body.token, body: { name: 'X', exercises: [], date: new Date().toISOString() } });
        assert.equal(w.status, 403);
        assert.equal(w.body.error, 'access_expired');
      }
    } finally { await srv.stop(); }
  }
});
