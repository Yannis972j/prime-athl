// Accès expiré (durée fixée par le coach dépassée) : l'athlète n'a plus accès qu'au Catalogue, à la
// messagerie et à son profil. Tout le reste est refusé PAR LE SERVEUR (403 access_expired) — y compris
// pour un athlète en accès complet, et y compris les appels IA (coûteux). Coachs exemptés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

test('accès expiré : seuls Catalogue, messagerie, profil (+ séance du Catalogue) passent ; le reste → 403', async () => {
  const day = 86400000, now = Date.now(), PW = 'longenough1';
  const hash = await bcrypt.hash(PW, 4);
  const mk = (id, extra) => ({ id, email: id + '@t.local', role: 'athlete', status: 'active', firstName: id, passwordHash: hash, createdAt: now, ...extra });
  const past = new Date(now - 3 * day).toISOString(), future = new Date(now + 6 * day).toISOString();
  const db = path.join(os.tmpdir(), `pa-exp-${crypto.randomUUID()}.json`);
  fs.writeFileSync(db, JSON.stringify({ users: {
    expfull: mk('expfull', { fullAccess: true, accessExpiresAt: past }),   // accès complet + durée écoulée
    expplain: mk('expplain', { accessExpiresAt: past }),
    active: mk('active', { fullAccess: true, accessExpiresAt: future }),
    unlimited: mk('unlimited', { fullAccess: true }),
  } }));
  const srv = await startServer({ DB_PATH: db });
  try {
    const login = async (email, password = PW) => (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email, password } })).body.token;
    const get = (tok, p) => api(srv.baseUrl, 'GET', p, { token: tok });
    const post = (tok, p, body) => api(srv.baseUrl, 'POST', p, { token: tok, body });
    const sess = extra => ({ name: 'S', exercises: [], date: new Date().toISOString(), ...extra });

    for (const who of ['expfull@t.local', 'expplain@t.local']) {
      const t = await login(who);
      // ── autorisé : profil, messagerie, notifications, Catalogue ──
      for (const p of ['/api/me', '/api/messages/summary', '/api/my-coach', '/api/push/status', '/api/training-programs/my-programs', '/api/stripe/status']) {
        const r = await get(t, p);
        assert.notEqual(r.status, 403, `${who} ${p} doit rester accessible (reçu ${r.status})`);
      }
      assert.equal((await get(t, '/api/me')).status, 200);
      // ── autorisé : enregistrer une séance issue du Catalogue ──
      const ok = await post(t, '/api/sessions', sess({ fromTrainingProgram: true }));
      assert.equal(ok.status, 200, `${who} séance du Catalogue`);
      // ── refusé : tout le reste ──
      for (const p of ['/api/program', '/api/sessions', '/api/session-library']) {
        const r = await get(t, p);
        assert.equal(r.status, 403, `${who} GET ${p}`); assert.equal(r.body.error, 'access_expired');
      }
      const bad = await post(t, '/api/sessions', sess());
      assert.equal(bad.status, 403, `${who} séance hors Catalogue`); assert.equal(bad.body.error, 'access_expired');
      const flagOff = await post(t, '/api/sessions', sess({ fromTrainingProgram: false }));
      assert.equal(flagOff.status, 403);
      for (const p of ['/api/ai/generate-program', '/api/ai/generate-nutrition', '/api/ai/regenerate-meal']) {
        const r = await post(t, p, { level: 'debutant', goal: 'masse', days: 3, equipment: 'salle' });
        assert.equal(r.status, 403, `${who} ${p} (appel IA = coût)`); assert.equal(r.body.error, 'access_expired');
      }
    }

    // ── non concernés : durée en cours, accès illimité, coach ──
    for (const who of ['active@t.local', 'unlimited@t.local']) {
      const t = await login(who);
      assert.equal((await get(t, '/api/program')).status, 200, `${who} programme`);
      assert.equal((await post(t, '/api/sessions', sess())).status, 200, `${who} séance`);
    }
    const coach = await login(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD);
    assert.equal((await get(coach, '/api/coach/athletes')).status, 200, 'coach exempté');
  } finally { await srv.stop(); }
});
