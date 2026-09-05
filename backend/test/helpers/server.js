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
export async function startServer(extraEnv = {}) {
  const port = 3000 + Math.floor(Math.random() * 20000);
  const dbPath = path.join(os.tmpdir(), `prime-athl-test-${crypto.randomUUID()}.json`);

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

  // Attend que le serveur réponde (max ~10s)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Le serveur s'est arrêté (code ${child.exitCode}).\nstderr:\n${stderr}`);
    }
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) break;
    } catch { /* pas encore prêt */ }
    await new Promise(res => setTimeout(res, 150));
  }

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
