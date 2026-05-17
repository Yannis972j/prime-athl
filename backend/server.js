// Prime Athl backend — Express + JSON file storage + Socket.IO
// Pure-JS, zero native deps. Run: npm install && npm start
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import http from 'http';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import webpush from 'web-push';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { pgEnabled, pgInit, pgLoad, pgSave, pgBackup, pgListBackups, pgGetBackup, pgRotateBackups } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT             = process.env.PORT       || 3001;
const NODE_ENV         = process.env.NODE_ENV   || 'development';
const IS_PROD          = NODE_ENV === 'production';
// JWT_SECRET : obligatoire en prod, sinon on refuse de démarrer (sécurité)
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET env var required in production');
  process.exit(1);
}
const JWT_SECRET       = process.env.JWT_SECRET || 'dev-secret-' + Math.random().toString(36).slice(2);
// Origines autorisées pour CORS (séparées par virgule). Wildcard si non défini (dev).
const CORS_ORIGINS     = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const PUBLIC_URL       = process.env.PUBLIC_URL || 'https://prime-athl.onrender.com';
const RESEND_API_KEY   = process.env.RESEND_API_KEY || '';
const RESEND_FROM      = process.env.RESEND_FROM || 'Prime Athl <onboarding@resend.dev>';
// Cloudinary — stockage photos. Env var: CLOUDINARY_URL (copie depuis dashboard Cloudinary)
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// VAPID keys pour Web Push. Génère-les une fois avec: node -e "const wp=await import('web-push'); console.log(JSON.stringify(wp.generateVAPIDKeys()))"
// Puis mets VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY en env vars sur Render.
const MAIN_COACH_EMAIL = (process.env.MAIN_COACH_EMAIL || 'yannisgym972@gmail.com').toLowerCase();
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(`mailto:${MAIN_COACH_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
const DB_PATH          = process.env.DB_PATH    || path.join(__dirname, 'data.json');
// Try multiple frontend paths (local dev, Render deploy)
const FRONTEND_CANDIDATES = [
  path.join(__dirname, 'public'),         // bundled inside backend (prod)
  path.join(__dirname, '..', 'muscu'),    // local dev (sibling folder)
];
const FRONTEND         = FRONTEND_CANDIDATES.find(p => fs.existsSync(p)) || FRONTEND_CANDIDATES[0];

// ── DB en mémoire : Postgres = source de vérité, fichier local = cache de secours ──
const DEFAULT_DB = { users: {}, programs: {}, sessions: {}, invites: {}, nutritionPrograms: {}, nutritionLogs: {}, weightLogs: {}, messages: {}, progressPhotos: {}, pushSubscriptions: {} };

// Boot : Postgres > fichier local
let DATA = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    for (const k of Object.keys(DEFAULT_DB)) if (!raw[k]) raw[k] = structuredClone(DEFAULT_DB[k]);
    return raw;
  } catch { return structuredClone(DEFAULT_DB); }
})();

const USE_PG = pgEnabled();
if (USE_PG) {
  try {
    await pgInit();
    const pgData = await pgLoad();
    if (pgData && Object.keys(pgData.users || {}).length > 0) {
      DATA = pgData;
      for (const k of Object.keys(DEFAULT_DB)) if (!DATA[k]) DATA[k] = structuredClone(DEFAULT_DB[k]);
      console.log('[boot] Loaded from Postgres :', Object.keys(DATA.users).length, 'users');
    } else if (Object.keys(DATA.users).length > 0) {
      await pgSave(DATA);
      console.log('[boot] Migrated local data to Postgres');
    } else {
      console.log('[boot] Postgres empty, starting fresh');
    }
  } catch (e) {
    console.error('[boot] Postgres init failed:', e.message);
  }
}

// ── Main-coach bootstrap ───────────────────────────
// Garantit que le compte coach principal existe TOUJOURS et avec le mot de passe défini en env.
// Plus jamais besoin de recréer le compte après un déploiement.
const MAIN_COACH_PASSWORD = process.env.MAIN_COACH_PASSWORD || '';
async function ensureMainCoach() {
  if (!MAIN_COACH_PASSWORD) {
    console.warn('[bootstrap] MAIN_COACH_PASSWORD not set → skip main-coach bootstrap');
    return;
  }
  let main = Object.values(DATA.users).find(u => (u.email || '').toLowerCase() === MAIN_COACH_EMAIL);
  const hash = await bcrypt.hash(MAIN_COACH_PASSWORD, 10);
  if (!main) {
    const id = 'main-coach-' + Math.random().toString(36).slice(2, 8);
    main = {
      id, email: MAIN_COACH_EMAIL, passwordHash: hash,
      role: 'coach', coachId: null,
      firstName: '', lastName: '', height: '', weight: '', objective: '',
      prSquat: '', prBench: '', prDeadlift: '',
      createdAt: Date.now(), status: 'active', isMainCoach: true,
    };
    DATA.users[id] = main;
    console.log('[bootstrap] Main coach CREATED:', MAIN_COACH_EMAIL);
  } else {
    main.passwordHash = hash;
    main.role = 'coach';
    main.status = 'active';
    main.isMainCoach = true;
    console.log('[bootstrap] Main coach password REFRESHED:', MAIN_COACH_EMAIL);
  }
  try { fs.writeFileSync(DB_PATH, JSON.stringify(DATA, null, 2)); } catch {}
}
await ensureMainCoach();

let saveTimer = null;
let pgSaveTimer = null;
let saving = false;
function persist() {
  // Sauvegarde fichier local (rapide, sync-safe)
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (saving) return;
    saving = true;
    try {
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(DATA, null, 2));
      fs.renameSync(tmp, DB_PATH);
    } catch (e) { console.error('persist error:', e); }
    saving = false;
  }, 200);
  // Postgres : debounce 2s, source de vérité durable
  if (USE_PG) {
    if (pgSaveTimer) clearTimeout(pgSaveTimer);
    pgSaveTimer = setTimeout(() => {
      pgSave(DATA).catch(e => console.error('[pg] save error:', e.message));
    }, 2000);
  }
}

// ── Daily auto-backup (Postgres uniquement) ─────────
if (USE_PG) {
  const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 backup par 24h
  const KEEP_BACKUPS = 30; // 30 jours d'historique
  const runBackup = async () => {
    try {
      const b = await pgBackup(DATA, 'auto-daily');
      await pgRotateBackups(KEEP_BACKUPS);
      console.log('[backup] Snapshot taken id=' + (b && b.id) + ' (keep last ' + KEEP_BACKUPS + ')');
    } catch (e) { console.error('[backup] error:', e.message); }
  };
  setInterval(runBackup, BACKUP_INTERVAL_MS);
  setTimeout(runBackup, 5 * 60 * 1000); // 1er backup 5 min après le boot (le temps que le serveur soit stable)
}

// ── Helpers ─────────────────────────────────────────
const uid        = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const inviteCode = () => 'PA-' + Math.random().toString(36).slice(2,8).toUpperCase();
const sign       = p => jwt.sign(p, JWT_SECRET, { expiresIn: '60d' });
const verify     = t => jwt.verify(t, JWT_SECRET);

const profileOf = u => u && {
  id: u.id, email: u.email, role: u.role, coachId: u.coachId,
  firstName: u.firstName || '', lastName: u.lastName || '',
  height: u.height || '', weight: u.weight || '', objective: u.objective || '',
  prSquat: u.prSquat || '', prBench: u.prBench || '', prDeadlift: u.prDeadlift || '',
  createdAt: u.createdAt,
  status: u.status || 'active',
  isMainCoach: !!u.isMainCoach,
  onboardedAt: u.onboardedAt || null,
  requestedRole: u.requestedRole || u.role || 'athlete',
};

const isMainCoach = u => u && (u.isMainCoach || u.email === MAIN_COACH_EMAIL);

const findUserByEmail = email => Object.values(DATA.users).find(u => u.email === email.toLowerCase());

// ── Middleware ──────────────────────────────────────
const authRequired = (req, res, next) => {
  // Accept token from httpOnly cookie OR Bearer header (rétro-compat)
  const cookieToken = req.cookies && req.cookies.pa_token;
  const h = req.headers.authorization;
  const headerToken = h && h.startsWith('Bearer ') ? h.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    req.user = verify(token);
    const u = DATA.users[req.user.id];
    if (!u) return res.status(401).json({ error: 'user_not_found' });
    if (u.status === 'pending') return res.status(403).json({ error: 'pending_approval' });
    next();
  } catch { res.status(401).json({ error: 'bad_token' }); }
};

const coachOnly = (req, res, next) => {
  if (req.user?.role !== 'coach') return res.status(403).json({ error: 'coach_only' });
  next();
};

const mainCoachOnly = (req, res, next) => {
  const u = DATA.users[req.user?.id];
  if (!isMainCoach(u)) return res.status(403).json({ error: 'main_coach_only' });
  next();
};

// ── App ─────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // Render / proxies → req.ip vrai

// Helmet : en-têtes de sécurité (XSS, clickjacking, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Inline scripts (Babel standalone) – on désactive le CSP pour l'instant
  crossOriginEmbedderPolicy: false,
}));

// CORS : strict en prod (liste blanche), permissif en dev
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // requêtes mobiles / same-origin
    if (CORS_ORIGINS.length === 0) return cb(null, true); // dev
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'), false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Rate-limit global doux (anti-DDOS basique) — 600 req / 5 min / IP
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/', globalLimiter);

// Rate-limit serré sur les endpoints d'authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 tentatives / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // ne pénalise pas les login réussis
  message: { error: 'too_many_auth_attempts', detail: 'Trop de tentatives. Réessaie dans 15 minutes.' },
});

// Redirect root to Muscu.html so https://prime-athl.onrender.com loads the app
// Root = landing page (index.html). L'app vit sur /Muscu.html.
// Le express.static plus bas servira automatiquement /index.html sur "/", mais on garde un fallback explicite :
app.get('/app', (req, res) => res.redirect('/Muscu.html'));

app.use(express.static(FRONTEND));

// Helper : pose un cookie httpOnly avec le JWT (en plus du Bearer renvoyé en JSON)
function setAuthCookie(res, token) {
  res.cookie('pa_token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'lax' : 'lax',
    maxAge: 60 * 24 * 60 * 60 * 1000, // 60 jours, comme le JWT
    path: '/',
  });
}
function clearAuthCookie(res) {
  res.clearCookie('pa_token', { path: '/' });
}

// ── Auth ────────────────────────────────────────────
// Verrouillage de compte : max 5 échecs / 15 min
const LOCK_THRESHOLD = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
function recordLoginFailure(user) {
  if (!user) return;
  const now = Date.now();
  user.loginFails = (user.loginFails || []).filter(t => now - t < LOCK_WINDOW_MS);
  user.loginFails.push(now);
  if (user.loginFails.length >= LOCK_THRESHOLD) {
    user.lockedUntil = now + LOCK_WINDOW_MS;
  }
}
function isLocked(user) {
  return user && user.lockedUntil && user.lockedUntil > Date.now();
}
function clearLoginFailures(user) {
  if (user) { user.loginFails = []; user.lockedUntil = null; }
}

app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, role, inviteCode: ic } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    if (password.length < 8)  return res.status(400).json({ error: 'password_too_short', detail: 'Minimum 8 caractères.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });

    const lowEmail = email.toLowerCase();
    if (findUserByEmail(lowEmail)) return res.status(400).json({ error: 'email_already_used' });

    // SECURITE : tout inscrit hors coach principal naît ATHLETE.
    // Le rôle "coach" demandé est conservé dans requestedRole pour info, mais ne donne aucun privilège.
    // Seul le coach principal peut promouvoir un athlète en coach via /api/admin/approve avec {role:'coach'}.
    const requestedRole = role === 'coach' ? 'coach' : 'athlete';
    let userRole = 'athlete';
    let coachId  = null;
    const isMain = lowEmail === MAIN_COACH_EMAIL;

    if (ic) {
      const inv = DATA.invites[ic.toUpperCase()];
      if (!inv || inv.used) return res.status(400).json({ error: 'invite_invalid' });
      coachId  = inv.coachId;
      userRole = 'athlete';
      inv.used = true;
      inv.usedAt = Date.now();
    }

    // Main coach is auto-promoted & active. Everyone else is pending.
    const status = isMain ? 'active' : 'pending';
    if (isMain) userRole = 'coach';

    const id = uid();
    const passwordHash = await bcrypt.hash(password, 12); // 10 → 12 (plus résistant)
    const u = {
      id, email: lowEmail, passwordHash, role: userRole, coachId,
      firstName: '', lastName: '', height: '', weight: '', objective: '',
      prSquat: '', prBench: '', prDeadlift: '',
      createdAt: Date.now(),
      status, isMainCoach: isMain,
      loginFails: [], lockedUntil: null,
      requestedRole, // ce qu'il a coché à l'inscription (pour info coach principal)
    };
    DATA.users[id] = u;
    persist();

    // Notify main coach of new pending request
    if (!isMain) {
      const main = Object.values(DATA.users).find(x => x.isMainCoach && x.status === 'active');
      if (main) io.to('user:' + main.id).emit('pending-request', { user: profileOf(u) });
    }

    if (status === 'pending') {
      return res.json({ pending: true, message: "Demande envoyée. En attente d'approbation du coach principal." });
    }
    const token = sign({ id: u.id, role: u.role });
    setAuthCookie(res, token);
    res.json({ token, user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'signup_failed' }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = findUserByEmail((email || '').toLowerCase());
    // Réponse identique en temps constant si user inconnu (anti-énumération)
    if (!u) { await bcrypt.compare(password || '', '$2a$12$dummyhashdummyhashdummyhashdummyhashdummyhashdumm'); return res.status(401).json({ error: 'invalid_credentials' }); }
    if (isLocked(u)) {
      const mins = Math.ceil((u.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: 'account_locked', detail: `Compte verrouillé. Réessaie dans ${mins} min.` });
    }
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
      recordLoginFailure(u);
      persist();
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    if (u.status === 'pending') return res.status(403).json({ error: 'pending_approval' });
    clearLoginFailures(u);
    persist();
    const token = sign({ id: u.id, role: u.role });
    setAuthCookie(res, token);
    res.json({ token, user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'login_failed' }); }
});

// Logout : efface le cookie httpOnly
app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ── Reset password ──────────────────────────────────
import crypto from 'crypto';
const RESET_TTL_MS = 60 * 60 * 1000; // 1h
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

async function sendResetEmail(toEmail, link) {
  if (!RESEND_API_KEY) {
    console.log(`[reset] (no RESEND_API_KEY) Lien pour ${toEmail} : ${link}`);
    return { sent: false, reason: 'no_provider' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [toEmail],
        subject: 'Prime Athl — Réinitialise ton mot de passe',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a22;">
            <h1 style="font-size:22px;margin:0 0 12px;color:#d97757;">Prime Athl</h1>
            <p>Tu as demandé à réinitialiser ton mot de passe.</p>
            <p style="margin:24px 0;">
              <a href="${link}" style="display:inline-block;padding:12px 24px;background:#d97757;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">Choisir un nouveau mot de passe</a>
            </p>
            <p style="font-size:12px;color:#666;">Ce lien est valable 1 heure. Si tu n'es pas à l'origine de cette demande, ignore ce message.</p>
            <p style="font-size:11px;color:#999;margin-top:24px;">Lien complet : <br>${link}</p>
          </div>`,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('[resend] HTTP', r.status, txt);
      return { sent: false, reason: 'provider_error' };
    }
    return { sent: true };
  } catch (e) {
    console.error('[resend] error:', e.message);
    return { sent: false, reason: 'network' };
  }
}

// Demande de réinitialisation — toujours réponse 200 pour éviter l'énumération d'emails
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email_required' });
  const u = findUserByEmail(email);
  if (u) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    u.resetTokenHash = hashToken(rawToken);
    u.resetTokenExpiry = Date.now() + RESET_TTL_MS;
    persist();
    const link = `${PUBLIC_URL}/Muscu.html?reset=${rawToken}`;
    const r = await sendResetEmail(u.email, link);
    console.log(`[reset] generated for ${u.email} sent=${r.sent}`);
  } else {
    // Délai constant pour ne pas révéler l'existence du compte
    await new Promise(r => setTimeout(r, 250));
  }
  res.json({ ok: true, message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.' });
});

// Application du nouveau mot de passe
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'token_password_required' });
    if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
    const tokenHash = hashToken(token);
    const u = Object.values(DATA.users).find(x => x.resetTokenHash === tokenHash);
    if (!u) return res.status(400).json({ error: 'invalid_or_expired_token' });
    if (!u.resetTokenExpiry || u.resetTokenExpiry < Date.now()) {
      u.resetTokenHash = null; u.resetTokenExpiry = null;
      persist();
      return res.status(400).json({ error: 'invalid_or_expired_token' });
    }
    u.passwordHash = await bcrypt.hash(password, 12);
    u.resetTokenHash = null;
    u.resetTokenExpiry = null;
    u.loginFails = [];
    u.lockedUntil = null;
    persist();
    const newToken = sign({ id: u.id, role: u.role });
    setAuthCookie(res, newToken);
    res.json({ ok: true, token: newToken, user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'reset_failed' }); }
});

// Admin : liste des resets en cours (utile si aucun provider email configuré, pour donner le lien manuellement)
app.get('/api/admin/active-resets', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  const now = Date.now();
  const list = Object.values(DATA.users)
    .filter(u => u.resetTokenHash && u.resetTokenExpiry > now)
    .map(u => ({ email: u.email, expiresAt: u.resetTokenExpiry, expiresInMin: Math.round((u.resetTokenExpiry - now) / 60000) }));
  res.json({ resets: list, hasEmailProvider: !!RESEND_API_KEY });
});

// ── Marqueur d'onboarding ───────────────────────────
app.post('/api/me/onboarded', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  u.onboardedAt = Date.now();
  persist();
  res.json({ ok: true });
});

// ── Profile ─────────────────────────────────────────
app.get('/api/me', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json(profileOf(u));
});

const PROFILE_FIELDS = ['firstName','lastName','height','weight','objective','prSquat','prBench','prDeadlift'];

app.patch('/api/me', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  for (const k of PROFILE_FIELDS) {
    if (req.body[k] !== undefined) u[k] = req.body[k];
  }
  persist();
  const p = profileOf(u);
  if (u.coachId) io.to('user:' + u.coachId).emit('athlete-profile-updated', { athleteId: u.id, profile: p });
  res.json(p);
});

// ── Program ─────────────────────────────────────────
app.get('/api/program', authRequired, (req, res) => {
  const p = DATA.programs[req.user.id];
  res.json(p || { data: {}, assignedAt: null, assignedBy: null });
});

// Athlete uploads their own program (Excel import or manual)
app.put('/api/my-program', authRequired, (req, res) => {
  const data = req.body?.data || {};
  const ts = Date.now();
  DATA.programs[req.user.id] = { data, assignedBy: req.user.id, assignedAt: ts };
  persist();
  res.json({ ok: true, assignedAt: ts });
});

// ── Coach ───────────────────────────────────────────
app.get('/api/coach/athletes', authRequired, coachOnly, (req, res) => {
  const athletes = Object.values(DATA.users)
    .filter(u => u.coachId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(u => {
      const p = DATA.programs[u.id];
      const userSessions = Object.values(DATA.sessions).filter(s => s.userId === u.id);
      const lastSession = userSessions.reduce((m, s) => (!m || s.date > m.date) ? s : m, null);
      return {
        ...profileOf(u),
        program: p ? { data: p.data, assignedAt: p.assignedAt } : null,
        sessionCount: userSessions.length,
        lastSessionAt: lastSession ? lastSession.date : null,
      };
    });
  res.json(athletes);
});

app.get('/api/coach/athletes/:id', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const p = DATA.programs[u.id];
  const sessions = Object.values(DATA.sessions)
    .filter(s => s.userId === u.id)
    .sort((a, b) => b.date - a.date)
    .slice(0, 200);
  res.json({
    ...profileOf(u),
    program: p ? { data: p.data, assignedAt: p.assignedAt } : null,
    sessions: sessions.map(s => ({ id: s.id, date: s.date, name: s.name, totalVolume: s.totalVolume, exercises: s.exercises || [] })),
  });
});

app.delete('/api/coach/athletes/:id', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  u.coachId = null;
  persist();
  res.json({ removed: true });
});

// All athletes without a coach (can be claimed by any coach)
app.get('/api/coach/available-athletes', authRequired, coachOnly, (req, res) => {
  const list = Object.values(DATA.users)
    .filter(u => u.role === 'athlete' && !u.coachId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(u => {
      const p = DATA.programs[u.id];
      const userSessions = Object.values(DATA.sessions).filter(s => s.userId === u.id);
      const lastSession = userSessions.reduce((m, s) => (!m || s.date > m.date) ? s : m, null);
      return {
        ...profileOf(u),
        sessionCount: userSessions.length,
        lastSessionAt: lastSession ? lastSession.date : null,
        hasProgram: !!p,
      };
    });
  res.json(list);
});

// Coach claims an unassigned athlete (links coachId)
app.post('/api/coach/claim/:athleteId', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.athleteId];
  if (!u || u.role !== 'athlete') return res.status(404).json({ error: 'not_found' });
  if (u.coachId && u.coachId !== req.user.id) return res.status(403).json({ error: 'already_coached' });
  u.coachId = req.user.id;
  persist();
  // Notify athlete that they got a coach
  io.to('user:' + u.id).emit('my-profile-updated', { profile: profileOf(u) });
  res.json({ ok: true, profile: profileOf(u) });
});

// Coach edits athlete profile fields (firstName, lastName, height, weight, objective, PRs)
// Does NOT touch email, password, role, coachId
app.patch('/api/coach/athletes/:id', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  for (const k of PROFILE_FIELDS) {
    if (req.body[k] !== undefined) u[k] = req.body[k];
  }
  persist();
  const p = profileOf(u);
  // Notify athlete in real-time that their profile was updated by coach
  io.to('user:' + u.id).emit('my-profile-updated', { profile: p });
  res.json(p);
});

// Coach resets athlete data (profile / program / history)
app.post('/api/coach/athletes/:id/reset', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const opts = req.body || {};
  if (opts.profile) {
    for (const k of PROFILE_FIELDS) u[k] = '';
  }
  if (opts.history) {
    for (const sid of Object.keys(DATA.sessions)) {
      if (DATA.sessions[sid].userId === u.id) delete DATA.sessions[sid];
    }
  }
  if (opts.program) {
    delete DATA.programs[u.id];
    io.to('user:' + u.id).emit('program-updated', { data: {}, assignedAt: null });
  }
  persist();
  const p = profileOf(u);
  io.to('user:' + u.id).emit('my-profile-updated', { profile: p });
  res.json({ ok: true, profile: p });
});

// Coach deletes athlete's program (Excel import wipe)
app.delete('/api/coach/program/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  delete DATA.programs[req.params.athleteId];
  persist();
  io.to('user:' + req.params.athleteId).emit('program-updated', { data: {}, assignedAt: null });
  res.json({ ok: true });
});

// Coach deletes athlete's nutrition plan
app.delete('/api/coach/nutrition/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  delete DATA.nutritionPrograms[req.params.athleteId];
  persist();
  io.to('user:' + req.params.athleteId).emit('nutrition-updated', { plan: null, assignedAt: null });
  res.json({ ok: true });
});

// User deletes their OWN program / nutrition (coach for himself)
app.delete('/api/my-program', authRequired, (req, res) => {
  delete DATA.programs[req.user.id];
  persist();
  io.to('user:' + req.user.id).emit('program-updated', { data: {}, assignedAt: null });
  res.json({ ok: true });
});
app.delete('/api/my-nutrition', authRequired, (req, res) => {
  delete DATA.nutritionPrograms[req.user.id];
  persist();
  io.to('user:' + req.user.id).emit('nutrition-updated', { plan: null, assignedAt: null });
  res.json({ ok: true });
});

app.put('/api/coach/program/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const data = req.body?.data || {};
  const ts = Date.now();
  DATA.programs[req.params.athleteId] = { data, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + req.params.athleteId).emit('program-updated', { data, assignedAt: ts });
  const coachName = DATA.users[req.user.id]?.firstName || 'Ton coach';
  pushToUser(req.params.athleteId, { title: '💪 Nouveau programme', body: `${coachName} t'a assigné un nouveau programme d'entraînement`, url: '/Muscu.html' });
  res.json({ ok: true, assignedAt: ts });
});

// ── Coach: invites ──────────────────────────────────
app.post('/api/coach/invites', authRequired, coachOnly, (req, res) => {
  const code = inviteCode();
  DATA.invites[code] = { code, coachId: req.user.id, used: false, createdAt: Date.now() };
  persist();
  res.json({ code });
});

app.get('/api/coach/invites', authRequired, coachOnly, (req, res) => {
  const list = Object.values(DATA.invites)
    .filter(i => i.coachId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(i => ({ code: i.code, used: i.used, createdAt: i.createdAt }));
  res.json(list);
});

// ── Sessions ────────────────────────────────────────
app.get('/api/sessions', authRequired, (req, res) => {
  const target = req.query.userId || req.user.id;
  if (target !== req.user.id) {
    if (req.user.role !== 'coach') return res.status(403).json({ error: 'forbidden' });
    const a = DATA.users[target];
    if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  }
  const list = Object.values(DATA.sessions)
    .filter(s => s.userId === target)
    .sort((a, b) => b.date - a.date)
    .slice(0, 500)
    .map(s => ({ id: s.id, date: s.date, name: s.name, totalVolume: s.totalVolume, exercises: s.exercises || [] }));
  res.json(list);
});

app.post('/api/sessions', authRequired, (req, res) => {
  const id = uid();
  const { date, name, totalVolume, exercises } = req.body || {};
  const session = {
    id, userId: req.user.id,
    date: date || Date.now(),
    name: name || '',
    totalVolume: totalVolume || 0,
    exercises: exercises || [],
  };
  DATA.sessions[id] = session;
  persist();

  const u = DATA.users[req.user.id];
  if (u?.coachId) {
    io.to('user:' + u.coachId).emit('session-added', {
      athleteId: req.user.id,
      session: { id, date: session.date, name, totalVolume },
    });
  }
  res.json({ id });
});

// ── Backup / Restore (main coach only) ──────────────
app.get('/api/admin/backup', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="prime-athl-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(DATA, null, 2));
  } catch (e) {
    res.status(500).json({ error: 'backup_failed', detail: e.message });
  }
});

app.post('/api/admin/restore', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.users || !body.programs) {
      return res.status(400).json({ error: 'invalid_backup_format' });
    }
    // Validate that the current main coach is still in the backup (security)
    const mainBackup = Object.values(body.users).find(u => u.email === MAIN_COACH_EMAIL);
    if (!mainBackup) return res.status(400).json({ error: 'main_coach_missing_in_backup' });

    // Ensure DEFAULT_DB structure
    DATA = {
      users: body.users || {},
      programs: body.programs || {},
      sessions: body.sessions || {},
      invites: body.invites || {},
      nutritionPrograms: body.nutritionPrograms || {},
      nutritionLogs: body.nutritionLogs || {},
      weightLogs: body.weightLogs || {},
      messages: body.messages || {},
      progressPhotos: body.progressPhotos || {},
      pushSubscriptions: body.pushSubscriptions || {},
    };
    persist();
    res.json({ ok: true, counts: {
      users: Object.keys(DATA.users).length,
      programs: Object.keys(DATA.programs).length,
      sessions: Object.keys(DATA.sessions).length,
      nutritionPrograms: Object.keys(DATA.nutritionPrograms).length,
    }});
  } catch (e) {
    console.error('restore', e);
    res.status(500).json({ error: 'restore_failed', detail: e.message });
  }
});

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    users: Object.keys(DATA.users).length,
    dbPath: DB_PATH,
    persistent: USE_PG || DB_PATH.startsWith('/data'),
    storage: USE_PG ? 'postgres' : (DB_PATH.startsWith('/data') ? 'render-disk' : 'ephemeral'),
    timestamp: Date.now(),
  });
});

// ── Postgres backups (main coach only) ──────────────
app.get('/api/admin/pg-backups', authRequired, coachOnly, mainCoachOnly, async (req, res) => {
  if (!USE_PG) return res.status(400).json({ error: 'pg_not_configured' });
  try { res.json({ backups: await pgListBackups(60) }); }
  catch (e) { res.status(500).json({ error: 'list_failed', detail: e.message }); }
});

// Take a manual snapshot now
app.post('/api/admin/pg-backup', authRequired, coachOnly, mainCoachOnly, async (req, res) => {
  if (!USE_PG) return res.status(400).json({ error: 'pg_not_configured' });
  try {
    const b = await pgBackup(DATA, 'manual');
    await pgRotateBackups(30);
    res.json({ ok: true, id: b.id, created_at: b.created_at });
  } catch (e) { res.status(500).json({ error: 'backup_failed', detail: e.message }); }
});

// Restore from a specific backup id
app.post('/api/admin/pg-restore/:id', authRequired, coachOnly, mainCoachOnly, async (req, res) => {
  if (!USE_PG) return res.status(400).json({ error: 'pg_not_configured' });
  try {
    const b = await pgGetBackup(parseInt(req.params.id, 10));
    if (!b) return res.status(404).json({ error: 'backup_not_found' });
    const body = b.data;
    if (!body || !body.users) return res.status(400).json({ error: 'invalid_backup_format' });
    const mainBackup = Object.values(body.users).find(u => u.email === MAIN_COACH_EMAIL);
    if (!mainBackup) return res.status(400).json({ error: 'main_coach_missing_in_backup' });
    DATA = {
      users: body.users || {},
      programs: body.programs || {},
      sessions: body.sessions || {},
      invites: body.invites || {},
      nutritionPrograms: body.nutritionPrograms || {},
      nutritionLogs: body.nutritionLogs || {},
    };
    persist();
    res.json({ ok: true, restored_id: b.id, created_at: b.created_at });
  } catch (e) { res.status(500).json({ error: 'restore_failed', detail: e.message }); }
});

// Download a backup as JSON file
app.get('/api/admin/pg-backup/:id', authRequired, coachOnly, mainCoachOnly, async (req, res) => {
  if (!USE_PG) return res.status(400).json({ error: 'pg_not_configured' });
  try {
    const b = await pgGetBackup(parseInt(req.params.id, 10));
    if (!b) return res.status(404).json({ error: 'backup_not_found' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="prime-athl-backup-${b.id}.json"`);
    res.send(JSON.stringify(b.data, null, 2));
  } catch (e) { res.status(500).json({ error: 'download_failed', detail: e.message }); }
});

// ── Admin (main coach only) ─────────────────────────
app.get('/api/admin/pending', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  const list = Object.values(DATA.users)
    .filter(u => u.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(profileOf);
  res.json(list);
});

app.post('/api/admin/approve/:userId', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  const u = DATA.users[req.params.userId];
  if (!u) return res.status(404).json({ error: 'not_found' });
  // Le coach principal choisit explicitement le rôle final (athlete par défaut).
  // Si {role:'coach'} est passé, l'utilisateur est promu coach. Sinon il reste athlete.
  const targetRole = req.body && req.body.role === 'coach' ? 'coach' : 'athlete';
  u.status = 'active';
  u.role = targetRole;
  // Si athlete sans coach → rattaché au coach principal qui approuve
  if (targetRole === 'athlete' && !u.coachId) {
    u.coachId = req.user.id;
  }
  // Si promu coach → libéré de tout coachId, devient autonome
  if (targetRole === 'coach') {
    u.coachId = null;
  }
  persist();
  io.to('user:' + u.id).emit('account-approved', { profile: profileOf(u) });
  io.to('user:' + u.id).emit('my-profile-updated', { profile: profileOf(u) });
  res.json({ ok: true, profile: profileOf(u) });
});

app.post('/api/admin/reject/:userId', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  const u = DATA.users[req.params.userId];
  if (!u) return res.status(404).json({ error: 'not_found' });
  // Delete user and their data
  for (const sid of Object.keys(DATA.sessions)) {
    if (DATA.sessions[sid].userId === u.id) delete DATA.sessions[sid];
  }
  delete DATA.programs[u.id];
  delete DATA.users[u.id];
  persist();
  res.json({ ok: true, removed: true });
});

// ── Nutrition ───────────────────────────────────────
const ymd = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};

const DEFAULT_NUTRITION = {
  dailyCalories: 0,
  dailyProtein: 0,
  dailyCarbs: 0,
  dailyFat: 0,
  meals: [
    { id: 'breakfast',    label: 'Petit-déjeuner',    emoji: '🍳', timeStart: '05:00', timeEnd: '08:00', items: [], note: '' },
    { id: 'snack1',       label: 'Collation 1',       emoji: '🥜', timeStart: '09:00', timeEnd: '12:00', items: [], note: '' },
    { id: 'lunch',        label: 'Déjeuner',          emoji: '🍱', timeStart: '12:00', timeEnd: '14:00', items: [], note: '' },
    { id: 'snack2',       label: 'Collation 2',       emoji: '🍎', timeStart: '14:00', timeEnd: '16:00', items: [], note: '' },
    { id: 'snack3',       label: 'Collation 3',       emoji: '🥨', timeStart: '16:00', timeEnd: '18:00', items: [], note: '' },
    { id: 'dinner',       label: 'Dîner',             emoji: '🍝', timeStart: '20:00', timeEnd: '21:00', items: [], note: '' },
    { id: 'eveningSnack', label: 'Collation du soir', emoji: '🥛', timeStart: '21:00', timeEnd: '22:00', items: [], note: '' },
  ],
};

// Athlete fetches their nutrition plan + today's log + last 14 days
app.get('/api/nutrition', authRequired, (req, res) => {
  const plan = DATA.nutritionPrograms[req.user.id] || null;
  const logs = DATA.nutritionLogs[req.user.id] || {};
  const today = ymd(Date.now());
  const todayLog = logs[today] || { validated: {}, validatedAt: {} };
  // 14-day history
  const history = {};
  for (let i = 0; i < 14; i++) {
    const d = ymd(Date.now() - i * 24*3600*1000);
    history[d] = logs[d] || { validated: {}, validatedAt: {} };
  }
  res.json({ plan, today: { date: today, ...todayLog }, history });
});

// Athlete toggles a meal as validated for today
app.post('/api/nutrition/validate/:mealId', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const today = ymd(Date.now());
  if (!DATA.nutritionLogs[u.id]) DATA.nutritionLogs[u.id] = {};
  if (!DATA.nutritionLogs[u.id][today]) DATA.nutritionLogs[u.id][today] = { validated: {}, validatedAt: {} };
  const log = DATA.nutritionLogs[u.id][today];
  const mealId = req.params.mealId;
  const newVal = !log.validated[mealId];
  log.validated[mealId] = newVal;
  log.validatedAt[mealId] = newVal ? Date.now() : null;
  persist();
  // Notify coach
  if (u.coachId) io.to('user:' + u.coachId).emit('nutrition-meal-validated', { athleteId: u.id, mealId, validated: newVal, date: today });
  res.json({ ok: true, validated: newVal, date: today });
});

// User imports / updates their OWN nutrition plan (coach for himself, or athlete without coach)
app.put('/api/my-nutrition', authRequired, (req, res) => {
  const plan = req.body && req.body.plan ? req.body.plan : null;
  if (!plan) return res.status(400).json({ error: 'plan_required' });
  const ts = Date.now();
  DATA.nutritionPrograms[req.user.id] = { data: plan, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + req.user.id).emit('nutrition-updated', { plan, assignedAt: ts });
  res.json({ ok: true, assignedAt: ts });
});

// Coach assigns / updates nutrition plan
app.put('/api/coach/nutrition/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const plan = req.body && req.body.plan ? req.body.plan : null;
  if (!plan) return res.status(400).json({ error: 'plan_required' });
  const ts = Date.now();
  DATA.nutritionPrograms[a.id] = { data: plan, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + a.id).emit('nutrition-updated', { plan, assignedAt: ts });
  const coachNameN = DATA.users[req.user.id]?.firstName || 'Ton coach';
  pushToUser(a.id, { title: '🥗 Plan nutrition mis à jour', body: `${coachNameN} a mis à jour ton plan nutrition`, url: '/Muscu.html' });
  res.json({ ok: true, assignedAt: ts });
});

// Coach fetches athlete's nutrition (plan + history)
// ── Coach calendar — vue globale tous athlètes ────────────
app.get('/api/coach/calendar', authRequired, coachOnly, (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1; // 1-12
  const start = new Date(year, month - 1, 1).getTime();
  const end   = new Date(year, month, 1).getTime();
  const JS_TO_DAY = ['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'];
  const PALETTE = ['#d97757','#7cc4a1','#7ca8c4','#c97586','#c2a042','#a08fd4','#78b4b4'];

  const athletes = Object.values(DATA.users)
    .filter(u => u.coachId === req.user.id && u.status === 'active');

  const result = athletes.map((u, idx) => {
    // Sessions du mois
    const sessionDates = Object.values(DATA.sessions)
      .filter(s => s.userId === u.id && s.date >= start && s.date < end)
      .map(s => new Date(s.date).toISOString().slice(0,10));

    // Nutrition validée du mois (nutritionLogs)
    const logs = DATA.nutritionLogs[u.id] || {};
    const nutriDates = Object.keys(logs).filter(dateStr => {
      const d = new Date(dateStr).getTime();
      return d >= start && d < end && Object.values(logs[dateStr]||{}).some(v => v);
    });

    // Jours prévus au programme (noms de jours)
    const prog = DATA.programs[u.id];
    const programDays = prog
      ? [...new Set(Object.values(prog.data || {}).flatMap(sheet => Object.keys(sheet)))]
      : [];

    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email.split('@')[0];
    return {
      id: u.id,
      name,
      initials: ((u.firstName||'')[0]||'') + ((u.lastName||'')[0]||'') || name[0].toUpperCase(),
      color: PALETTE[idx % PALETTE.length],
      sessionDates,
      nutriDates,
      programDays,
      hasProgram: !!prog,
      hasNutrition: !!(DATA.nutritionPrograms[u.id]),
    };
  });

  res.json({ year, month, athletes: result });
});

app.get('/api/coach/athletes/:id/nutrition', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const plan = DATA.nutritionPrograms[u.id] || null;
  const logs = DATA.nutritionLogs[u.id] || {};
  const history = {};
  for (let i = 0; i < 30; i++) {
    const d = ymd(Date.now() - i * 24*3600*1000);
    history[d] = logs[d] || { validated: {}, validatedAt: {} };
  }
  res.json({ plan, history });
});

// Default template (so coach UI can prefill)
app.get('/api/nutrition/template', authRequired, coachOnly, (req, res) => {
  res.json({ template: DEFAULT_NUTRITION });
});

// ── Widget data (for home-screen widget scripts) ────
app.get('/api/widget', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const p = DATA.programs[u.id];
  const sessions = Object.values(DATA.sessions).filter(s => s.userId === u.id).sort((a,b) => b.date - a.date);
  const lastSession = sessions[0] || null;
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const sessionsThisWeek = sessions.filter(s => now - s.date < weekMs).length;
  const totalVolumeWeek = sessions.filter(s => now - s.date < weekMs).reduce((sum, s) => sum + (s.totalVolume || 0), 0);
  // Find next day (any day in the program, simplified)
  let nextDay = null;
  if (p && p.data) {
    const sheets = Object.keys(p.data);
    const lastSheet = sheets[sheets.length - 1];
    if (lastSheet) {
      const days = Object.keys(p.data[lastSheet]);
      const order = ['LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI','DIMANCHE'];
      days.sort((a,b) => order.indexOf(a) - order.indexOf(b));
      const todayIdx = (new Date().getDay() + 6) % 7;
      const todayName = order[todayIdx];
      nextDay = days.find(d => d === todayName) || days[0];
      if (nextDay) {
        const d = p.data[lastSheet][nextDay];
        nextDay = { name: nextDay, category: d.category, exerciseCount: (d.exercises || []).length, month: lastSheet };
      }
    }
  }
  res.json({
    firstName: u.firstName || '',
    role: u.role,
    nextDay,
    lastSession: lastSession ? { name: lastSession.name, totalVolume: lastSession.totalVolume, date: lastSession.date } : null,
    weekStats: { sessions: sessionsThisWeek, volume: Math.round(totalVolumeWeek) },
    prs: { squat: u.prSquat || null, bench: u.prBench || null, deadlift: u.prDeadlift || null },
  });
});

// ── My coach info (for athlete) ─────────────────────
app.get('/api/my-coach', authRequired, (req, res) => {
  const me = DATA.users[req.user.id];
  if (!me || !me.coachId) return res.status(404).json({ error: 'no_coach' });
  const coach = DATA.users[me.coachId];
  if (!coach) return res.status(404).json({ error: 'coach_not_found' });
  res.json({ id: coach.id, email: coach.email, firstName: coach.firstName, lastName: coach.lastName, role: coach.role });
});

// ── Weight logs ─────────────────────────────────────
app.get('/api/weight', authRequired, (req, res) => {
  const logs = (DATA.weightLogs[req.user.id] || []).slice().sort((a,b) => a.date - b.date);
  res.json({ logs });
});

app.post('/api/weight', authRequired, (req, res) => {
  const { weight, date } = req.body || {};
  if (!weight || isNaN(parseFloat(weight))) return res.status(400).json({ error: 'weight_required' });
  const entry = { id: uid(), weight: parseFloat(weight), date: date || Date.now(), createdAt: Date.now() };
  if (!DATA.weightLogs[req.user.id]) DATA.weightLogs[req.user.id] = [];
  DATA.weightLogs[req.user.id].push(entry);
  persist();
  res.json({ ok: true, entry });
});

app.delete('/api/weight/:id', authRequired, (req, res) => {
  const logs = DATA.weightLogs[req.user.id] || [];
  DATA.weightLogs[req.user.id] = logs.filter(l => l.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Coach can view athlete weight
app.get('/api/coach/athletes/:id/weight', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const logs = (DATA.weightLogs[u.id] || []).slice().sort((a,b) => a.date - b.date);
  res.json({ logs });
});

// ── Upload fichier → Cloudinary (ou base64 fallback) ──
app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  if (process.env.CLOUDINARY_URL) {
    try {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'prime-athl', transformation: [{ width: 1200, crop: 'limit', quality: 'auto:good' }] },
          (err, r) => err ? reject(err) : resolve(r)
        ).end(req.file.buffer);
      });
      return res.json({ url: result.secure_url });
    } catch(e) {
      return res.status(500).json({ error: 'upload_failed', detail: e.message });
    }
  }
  // Fallback base64 si Cloudinary non configuré
  const b64 = req.file.buffer.toString('base64');
  res.json({ url: `data:${req.file.mimetype};base64,${b64}` });
});

// ── Progress photos ──────────────────────────────────
app.get('/api/photos', authRequired, (req, res) => {
  const photos = (DATA.progressPhotos[req.user.id] || []).slice().sort((a,b) => b.date - a.date);
  res.json({ photos });
});

const MAX_PHOTOS_PER_USER = 50;
app.post('/api/photos', authRequired, (req, res) => {
  const { url, dataUrl, note, date } = req.body || {};
  const src = url || dataUrl;
  if (!src) return res.status(400).json({ error: 'url_required' });
  // Limite taille uniquement pour base64 (les URLs Cloudinary sont légères)
  if (src.startsWith('data:') && src.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'photo_too_large', detail: 'Max 3MB' });
  if (!DATA.progressPhotos[req.user.id]) DATA.progressPhotos[req.user.id] = [];
  if (DATA.progressPhotos[req.user.id].length >= MAX_PHOTOS_PER_USER) {
    return res.status(400).json({ error: 'photo_limit_reached', detail: `Maximum ${MAX_PHOTOS_PER_USER} photos` });
  }
  const photo = { id: uid(), url: src, note: note || '', date: date || Date.now(), createdAt: Date.now() };
  DATA.progressPhotos[req.user.id].unshift(photo);
  persist();
  res.json({ ok: true, photo });
});

app.delete('/api/photos/:id', authRequired, (req, res) => {
  const photos = DATA.progressPhotos[req.user.id] || [];
  DATA.progressPhotos[req.user.id] = photos.filter(p => p.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.get('/api/coach/athletes/:id/photos', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const photos = (DATA.progressPhotos[u.id] || []).slice().sort((a,b) => b.date - a.date);
  res.json({ photos });
});

// ── Messages ─────────────────────────────────────────
function chatId(a, b) { return [a, b].sort().join('_'); }

app.get('/api/messages/:partnerId', authRequired, (req, res) => {
  const me = req.user.id;
  const partner = req.params.partnerId;
  // Verify partner exists and is accessible (coach↔athlete)
  const partnerUser = DATA.users[partner];
  if (!partnerUser) return res.status(404).json({ error: 'not_found' });
  const key = chatId(me, partner);
  const msgs = (DATA.messages[key] || []).slice().sort((a,b) => a.createdAt - b.createdAt);
  res.json({ messages: msgs });
});

app.post('/api/messages/:partnerId', authRequired, (req, res) => {
  const me = req.user.id;
  const partner = req.params.partnerId;
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text_required' });
  const partnerUser = DATA.users[partner];
  if (!partnerUser) return res.status(404).json({ error: 'not_found' });
  const key = chatId(me, partner);
  const msg = { id: uid(), senderId: me, text: text.trim(), createdAt: Date.now() };
  if (!DATA.messages[key]) DATA.messages[key] = [];
  DATA.messages[key].push(msg);
  persist();
  // Emit to both participants
  io.to('user:' + partner).emit('new-message', { from: me, msg });
  io.to('user:' + me).emit('new-message', { from: me, msg });
  // Push notification to partner if subscribed
  const sub = DATA.pushSubscriptions[partner];
  if (sub && VAPID_PUBLIC_KEY) {
    const sender = DATA.users[me];
    const name = sender?.firstName || sender?.email?.split('@')[0] || 'Coach';
    webpush.sendNotification(sub, JSON.stringify({
      title: `💬 ${name}`,
      body: text.trim().slice(0, 100),
      tag: `msg-${me}`,
      url: '/Muscu.html'
    })).catch(() => { delete DATA.pushSubscriptions[partner]; persist(); });
  }
  res.json({ ok: true, msg });
});

// ── Push helper ──────────────────────────────────────
function pushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY) return;
  const sub = DATA.pushSubscriptions[userId];
  if (!sub) return;
  webpush.sendNotification(sub, JSON.stringify(payload))
    .catch(() => { delete DATA.pushSubscriptions[userId]; persist(); });
}

// ── Push subscriptions ────────────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY || null });
});

app.post('/api/push/subscribe', authRequired, (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription) return res.status(400).json({ error: 'subscription_required' });
  DATA.pushSubscriptions[req.user.id] = subscription;
  persist();
  res.json({ ok: true });
});

app.delete('/api/push/subscribe', authRequired, (req, res) => {
  delete DATA.pushSubscriptions[req.user.id];
  persist();
  res.json({ ok: true });
});

// ── Server + Socket.IO ──────────────────────────────
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('no_token'));
  try { socket.user = verify(token); next(); }
  catch { next(new Error('bad_token')); }
});

io.on('connection', (socket) => {
  socket.join('user:' + socket.user.id);
});

// Global error handlers — keep server alive on unexpected errors
process.on('uncaughtException', err => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection:', reason);
});

// Express error middleware (catches sync errors in routes)
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error', detail: err.message });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Prime Athl backend on http://0.0.0.0:${PORT}`);
  console.log(`Frontend served from ${FRONTEND}`);
  console.log(`DB file: ${DB_PATH}`);
  console.log(`Persistent storage: ${DB_PATH.startsWith('/data') ? 'YES (Render Disk)' : 'NO (ephemeral)'}`);
});
