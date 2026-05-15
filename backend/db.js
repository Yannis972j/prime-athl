// Prime Athl — Postgres persistence + automatic backups
// Schéma minimal : 1 ligne "snapshot" + table d'historique pour les backups
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || '';
export const USE_PG = !!DATABASE_URL;

let pool = null;

export function pgEnabled() { return USE_PG; }

export async function pgInit() {
  if (!USE_PG) return false;
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Neon/Supabase/Render Postgres exigent SSL en prod
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 4,
  });

  // Table "snapshot" : 1 seule ligne id=1 contenant le JSON complet
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_snapshot (
      id INT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Table "backups" : historique timestampé (rotation à 30 jours)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_backups (
      id BIGSERIAL PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      label TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_app_backups_created ON app_backups(created_at DESC);
  `);

  return true;
}

export async function pgLoad() {
  if (!pool) return null;
  const r = await pool.query('SELECT data FROM app_snapshot WHERE id = 1');
  if (r.rowCount === 0) return null;
  return r.rows[0].data;
}

export async function pgSave(data) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO app_snapshot (id, data, updated_at) VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)]
  );
}

export async function pgBackup(data, label = null) {
  if (!pool) return null;
  const r = await pool.query(
    `INSERT INTO app_backups (data, label) VALUES ($1::jsonb, $2) RETURNING id, created_at`,
    [JSON.stringify(data), label]
  );
  return r.rows[0];
}

export async function pgListBackups(limit = 30) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, created_at, label, octet_length(data::text) AS size_bytes
     FROM app_backups ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

export async function pgGetBackup(id) {
  if (!pool) return null;
  const r = await pool.query(`SELECT id, data, created_at, label FROM app_backups WHERE id = $1`, [id]);
  if (r.rowCount === 0) return null;
  return r.rows[0];
}

// Rotation : garde N backups les plus récents
export async function pgRotateBackups(keep = 30) {
  if (!pool) return 0;
  const r = await pool.query(
    `DELETE FROM app_backups
     WHERE id NOT IN (SELECT id FROM app_backups ORDER BY created_at DESC LIMIT $1)`,
    [keep]
  );
  return r.rowCount;
}
