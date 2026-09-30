// Helper de test : démarre server.js dans un process isolé, sur un port éphémère,
// avec une base JSON temporaire (aucun DATABASE_URL → pas de Postgres, aucun effet
// de bord sur la vraie donnée). Attend que /api/health réponde avant de rendre la main.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', '..', 'server.js');

export const MAIN_COACH_EMAIL = 'coach@test.local';
export const MAIN_COACH_PASSWORD = 'testpassword123';

// Démarre une instance et renvoie { baseUrl, stop() }.
// Le port est tiré au hasard : il peut entrer en collision avec un autre process (autre test,
// serveur de dev local…), ce qui faisait échouer le démarrage de façon intermittente. On réessaie
// donc sur un nouveau port tant que le serveur meurt tôt (typiquement EADDRINUSE).
export async function startServer(extraEnv = {}) {
  const dbPath = path.join(os.tmpdir(), `prime-athl-test-${crypto.randomUUID()}.json`);
  const MAX_ATTEMPTS = 5;
  let lastErr = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = 3000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        NODE_ENV: 'development',      // évite le exit(1) prod si secrets manquants
        PORT: String(port),
        DB_PATH: dbPath,
        DATABASE_URL: '',             // force la persistance fichier (isolée)
        JWT_SECRET: 'test-secret-fixed',
        MAIN_COACH_EMAIL,
        MAIN_COACH_PASSWORD,
        UNLOCK_SECRET: 'test-unlock-secret',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    const baseUrl = `http://127.0.0.1:${port}`;

    // Attend que le serveur réponde (max ~30s) — marge large pour les runners CI chargés, où un
    // démarrage lent provoquait un "fetch failed" intermittent (test instable, pas un vrai échec).
    const deadline = Date.now() + 30_000;
    let ready = false, died = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) { died = true; break; } // mort tôt → port occupé, on réessaie
      try {
        const r = await fetch(`${baseUrl}/api/health`);
        if (r.ok) { ready = true; break; }
      } catch { /* pas encore prêt */ }
      await new Promise(res => setTimeout(res, 150));
    }

    if (ready) {
      const stop = () => new Promise(resolve => {
        child.once('exit', () => {
          try { fs.rmSync(dbPath, { force: true }); } catch {}
          try { fs.rmSync(dbPath + '.tmp', { force: true }); } catch {}
          resolve();
        });
        child.kill('SIGKILL');
      });
      return { baseUrl, stop, port };
    }

    // Pas prêt : on tue l'instance (si encore vivante) avant de retenter sur un autre port.
    lastErr = died
      ? new Error(`Le serveur s'est arrêté (code ${child.exitCode}).\nstderr:\n${stderr}`)
      : new Error(`Le serveur n'a pas répondu à temps sur le port ${port}.\nstderr:\n${stderr}`);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch {} }
  }

  try { fs.rmSync(dbPath, { force: true }); } catch {}
  throw lastErr || new Error('startServer: échec après plusieurs tentatives');
}

// Petit wrapper JSON pour les tests.
export async function api(baseUrl, method, pathname, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* réponse non-JSON */ }
  return { status: r.status, body: json };
}
