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
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import webpush from 'web-push';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { pgEnabled, pgInit, pgLoad, pgSave, pgBackup, pgListBackups, pgGetBackup, pgRotateBackups } from './db.js';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
let Stripe; try { Stripe = (await import('stripe')).default; } catch(e) { console.warn('[stripe] package not available:', e.message); }

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
if (IS_PROD && !PUBLIC_URL.startsWith('https://')) {
  console.error('[config] FATAL: PUBLIC_URL doit commencer par https:// en production — les liens emails seront cassés.');
  process.exit(1);
}
if (!IS_PROD && !PUBLIC_URL.startsWith('http')) {
  console.warn('[config] WARNING: PUBLIC_URL invalide — les liens emails ne fonctionneront pas.');
}

// ── Validation des variables d'environnement optionnelles ───────────────────
// Ces features sont désactivées silencieusement si les vars manquent.
// On log un avertissement clair au boot pour éviter les surprises.
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[config] ANTHROPIC_API_KEY non défini — génération IA désactivée (/api/ai/*)');
}
if (!process.env.CLOUDINARY_URL) {
  console.warn('[config] CLOUDINARY_URL non défini — upload photos limité à 500KB (base64 fallback)');
}
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn('[config] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non définis — notifications push désactivées');
}
if (!process.env.RESEND_API_KEY) {
  console.warn('[config] RESEND_API_KEY non défini — envoi d\'emails désactivé (reset password, vérification)');
}
const RESEND_API_KEY   = process.env.RESEND_API_KEY || '';
const RESEND_FROM      = process.env.RESEND_FROM || 'Prime Athl <onboarding@resend.dev>';
if (RESEND_API_KEY && /onboarding@resend\.dev/i.test(RESEND_FROM)) {
  console.warn('[config] RESEND_FROM utilise le domaine sandbox "onboarding@resend.dev" : Resend refuse alors l\'envoi vers toute adresse autre que celle du compte Resend (les athlètes ne recevront ni email de réinitialisation de mot de passe, ni notification). Vérifie un domaine sur resend.com/domains puis configure RESEND_FROM avec une adresse de ce domaine.');
}
// Cloudinary — stockage photos. Env var: CLOUDINARY_URL (copie depuis dashboard Cloudinary)
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// VAPID keys pour Web Push. Génère-les une fois avec: node -e "const wp=await import('web-push'); console.log(JSON.stringify(wp.generateVAPIDKeys()))"
// Puis mets VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY en env vars sur Render.
const MAIN_COACH_EMAIL = (process.env.MAIN_COACH_EMAIL || 'yannisgym972@gmail.com').toLowerCase();

// ── Stripe ───────────────────────────────────────────
const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_EXPLORER  = process.env.STRIPE_PRICE_EXPLORER || '';  // 4,99€/mois
const STRIPE_PRICE_IA        = process.env.STRIPE_PRICE_IA || '';         // 14,99€/mois
const STRIPE_PRICE_COACHING  = process.env.STRIPE_PRICE_COACHING || '';   // 24,99€/mois
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;

// Mapping price_id → plan slug
const PRICE_TO_PLAN = {};
if (STRIPE_PRICE_EXPLORER) PRICE_TO_PLAN[STRIPE_PRICE_EXPLORER] = 'explorer';
if (STRIPE_PRICE_IA)       PRICE_TO_PLAN[STRIPE_PRICE_IA]       = 'ia';
if (STRIPE_PRICE_COACHING) PRICE_TO_PLAN[STRIPE_PRICE_COACHING] = 'coaching';

// Accès par plan (cascade) : coaching > ia > explorer
const PLAN_UNIVERSES = {
  explorer: ['explorer'],
  ia:       ['explorer', 'ia'],
  coaching: ['explorer', 'ia', 'coach'],
};

// Durée de l'essai gratuit
const TRIAL_MS = 7 * 24 * 3600 * 1000;

function userHasAccess(u, universe) {
  if (!u) return false;
  if (u.email === MAIN_COACH_EMAIL) return true;
  if (u.role === 'coach') return true;
  if (u.fullAccess) return true;
  if (Date.now() < (u.createdAt || 0) + TRIAL_MS) return true;
  if (u.stripeStatus === 'active' && u.stripePlan) {
    return (PLAN_UNIVERSES[u.stripePlan] || []).includes(universe);
  }
  return false;
}
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
const DEFAULT_DB = { users: {}, programs: {}, sessions: {}, invites: {}, nutritionPrograms: {}, nutritionLogs: {}, weightLogs: {}, messages: {}, progressPhotos: {}, pushSubscriptions: {}, savedPrograms: {}, premiumCodes: {}, freeFoodLogs: {}, customFoods: {}, sessionLibrary: {}, myLibrary: {} };

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
// Garantit que le compte coach principal existe TOUJOURS avec un accès total.
// Mot de passe par défaut si aucune variable d'env n'est définie.
// Garantit que le compte coach principal a TOUJOURS un accès total, même après
// un redéploiement sur disque éphémère (Render free tier).
const DEFAULT_MAIN_COACH_PASSWORD = 'PrimeAthl2024!';
const MAIN_COACH_PASSWORD = process.env.MAIN_COACH_PASSWORD || DEFAULT_MAIN_COACH_PASSWORD;
async function ensureMainCoach() {
  let main = Object.values(DATA.users).find(u => (u.email || '').toLowerCase() === MAIN_COACH_EMAIL);
  if (!main) {
    // Aucun compte → on le crée avec le mot de passe (env ou défaut).
    const id = 'main-coach-' + Math.random().toString(36).slice(2, 8);
    const hash = await bcrypt.hash(MAIN_COACH_PASSWORD, 10);
    main = {
      id, email: MAIN_COACH_EMAIL, passwordHash: hash,
      role: 'coach', coachId: null,
      firstName: '', lastName: '', height: '', weight: '', objective: '',
      prSquat: '', prBench: '', prDeadlift: '',
      createdAt: Date.now(), status: 'active', isMainCoach: true,
      tokenVersion: 0,
    };
    DATA.users[id] = main;
    console.log('[bootstrap] Main coach CREATED with full access:', MAIN_COACH_EMAIL);
  } else {
    // Le compte existe → on garantit l'accès total. On ne réécrit le mot de passe
    // QUE si MAIN_COACH_PASSWORD est explicitement défini en env (pour ne pas
    // écraser un mot de passe choisi par l'utilisateur via l'app).
    if (process.env.MAIN_COACH_PASSWORD) {
      main.passwordHash = await bcrypt.hash(process.env.MAIN_COACH_PASSWORD, 10);
      console.log('[bootstrap] Main coach password REFRESHED from env:', MAIN_COACH_EMAIL);
    }
    main.role = 'coach';
    main.status = 'active';
    main.isMainCoach = true;
    // Débloquer le verrou de tentatives à chaque boot
    main.loginFails = [];
    main.lockedUntil = null;
    console.log('[bootstrap] Main coach access ENSURED:', MAIN_COACH_EMAIL);
  }
  try { fs.writeFileSync(DB_PATH, JSON.stringify(DATA, null, 2)); } catch {}
}
await ensureMainCoach();

// ── Seed aliments créoles (Martinique) — exécuté une seule fois ──────────────
// Valeurs nutritionnelles approximatives basées sur CIQUAL / FoodData / sources publiques.
// Tous marqués is_public=true (accessibles à tous les coachs et athlètes).
function seedCreoleFoods() {
  const seeded = Object.values(DATA.customFoods).some(f => f.isSeed);
  if (seeded) return;
  const CREOLE_FOODS = [
    { name: 'Colombo de poulet',   kcal: 165, p: 14, c: 8,  f: 8,  unit: 'g' },
    { name: 'Accras de morue',     kcal: 280, p: 11, c: 25, f: 16, unit: 'g' },
    { name: 'Boudin créole',       kcal: 295, p: 14, c: 5,  f: 25, unit: 'g' },
    { name: 'Christophine',        kcal: 19,  p: 0.8, c: 4.5, f: 0.1, unit: 'g' },
    { name: 'Ti-nain (banane verte cuite)', kcal: 122, p: 1.3, c: 28, f: 0.4, unit: 'g' },
    { name: 'Fruit à pain cuit',   kcal: 105, p: 1.1, c: 27, f: 0.2, unit: 'g' },
    { name: 'Lambis (chair cuite)', kcal: 137, p: 26, c: 2.4, f: 1.2, unit: 'g' },
    { name: 'Igname cuite',        kcal: 116, p: 1.5, c: 27, f: 0.2, unit: 'g' },
    { name: 'Giraumon (potiron antillais)', kcal: 26, p: 1, c: 6, f: 0.1, unit: 'g' },
    { name: 'Dachine (madère cuite)', kcal: 142, p: 2, c: 34, f: 0.1, unit: 'g' },
    { name: 'Riz collé pois rouges', kcal: 145, p: 5, c: 26, f: 1.5, unit: 'g' },
    { name: 'Bokit (pain frit)',   kcal: 380, p: 9, c: 45, f: 18, unit: 'g' },
    { name: 'Court-bouillon de poisson', kcal: 110, p: 18, c: 3, f: 3, unit: 'g' },
    { name: 'Sauce chien',         kcal: 60,  p: 1, c: 4, f: 5, unit: 'g' },
    { name: 'Plantain mûr poêlé',  kcal: 165, p: 1.3, c: 36, f: 3, unit: 'g' },
  ];
  const mkId = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
  for (const f of CREOLE_FOODS) {
    const id = mkId();
    DATA.customFoods[id] = {
      id,
      coachId: null,            // null = aliment système (créole ou OFF)
      name: f.name,
      nameNormalized: f.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
      kcalPer100g: f.kcal,
      pPer100g:    f.p,
      cPer100g:    f.c,
      fPer100g:    f.f,
      isPublic: true,
      isSeed: true,
      source: 'creole',
      createdAt: Date.now(),
    };
  }
  console.log(`[seed] ${CREOLE_FOODS.length} aliments créoles ajoutés`);
}
seedCreoleFoods();

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
      fs.writeFileSync(tmp, JSON.stringify(DATA));
      fs.renameSync(tmp, DB_PATH);
    } catch (e) { console.error('persist error:', e); } finally { saving = false; }
  }, 200);
  // Postgres : debounce 500ms (aligné proche du local pour réduire la fenêtre d'inconsistance)
  if (USE_PG) {
    if (pgSaveTimer) clearTimeout(pgSaveTimer);
    pgSaveTimer = setTimeout(() => {
      pgSave(DATA).catch(e => console.error('[pg] save error:', e.message));
    }, 500);
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

// ── Nettoyage mémoire périodique ─────────────────────
setInterval(() => {
  const mb = v => Math.round(v / 1024 / 1024);
  const mem = process.memoryUsage();
  console.log(`[mem] rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB`);

  // Purge nutritionLogs > 90 jours
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const cutoffStr = new Date(cutoff).toISOString().slice(0, 10);
  let removedNutrition = 0;
  for (const uid of Object.keys(DATA.nutritionLogs || {})) {
    for (const dateKey of Object.keys(DATA.nutritionLogs[uid] || {})) {
      if (dateKey < cutoffStr) { delete DATA.nutritionLogs[uid][dateKey]; removedNutrition++; }
    }
  }

  // Supprime les comptes pending > 30 jours (inscrits mais jamais approuvés)
  const PENDING_TTL = 30 * 24 * 60 * 60 * 1000;
  let removedPending = 0;
  for (const u of Object.values(DATA.users)) {
    if (u.status === 'pending' && Date.now() - (u.createdAt || 0) > PENDING_TTL) {
      delete DATA.users[u.id];
      delete DATA.programs[u.id];
      delete DATA.savedPrograms[u.id];
      delete DATA.myLibrary[u.id];
      removedPending++;
    }
  }
  if (removedPending > 0) console.log(`[cleanup] ${removedPending} compte(s) pending expirés supprimés`);

  // Purge les push subscriptions expirées (endpoint invalide depuis > 7 jours)
  // Elles sont marquées .invalidatedAt lors d'une erreur 410/404 webpush
  const PUSH_STALE_TTL = 7 * 24 * 60 * 60 * 1000;
  let removedPush = 0;
  for (const [userId, sub] of Object.entries(DATA.pushSubscriptions || {})) {
    if (sub && sub.invalidatedAt && Date.now() - sub.invalidatedAt > PUSH_STALE_TTL) {
      delete DATA.pushSubscriptions[userId];
      removedPush++;
    }
  }
  if (removedPush > 0) console.log(`[cleanup] ${removedPush} push subscription(s) expirées supprimées`);

  if (removedPending > 0 || removedPush > 0 || removedNutrition > 0) persist();
}, 60 * 60 * 1000); // toutes les heures

// ── Helpers ─────────────────────────────────────────
const uid        = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const inviteCode = () => 'PA-' + Math.random().toString(36).slice(2,8).toUpperCase();
const sign       = p => jwt.sign(p, JWT_SECRET, { expiresIn: '60d' });
const verify     = t => jwt.verify(t, JWT_SECRET);
// Signe un token incluant la version du token (pour invalidation à la déconnexion)
const signForUser = u => sign({ id: u.id, role: u.role, tv: u.tokenVersion || 0 });

const profileOf = u => u && {
  id: u.id, email: u.email, role: u.role, coachId: u.coachId,
  firstName: u.firstName || '', lastName: u.lastName || '',
  height: u.height || '', weight: u.weight || '', objective: u.objective || '',
  prSquat: u.prSquat || '', prBench: u.prBench || '', prDeadlift: u.prDeadlift || '',
  avatarUrl: u.avatarUrl || '',
  createdAt: u.createdAt,
  status: u.status || 'active',
  isMainCoach: !!u.isMainCoach,
  onboardedAt: u.onboardedAt || null,
  requestedRole: u.requestedRole || u.role || 'athlete',
  premium: !!u.premium,
  fullAccess: !!u.fullAccess,
  stripeStatus: u.stripeStatus || null,
  stripePlan: u.stripePlan || null,
  stripeCustomerId: u.stripeCustomerId || null,
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
    // Vérifie que le token n'a pas été révoqué (logout ou changement de mot de passe)
    if ((req.user.tv ?? 0) !== (u.tokenVersion || 0)) return res.status(401).json({ error: 'token_revoked' });
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

app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') return next();
  express.json({ limit: '5mb' })(req, res, next);
});
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

// Rate-limit serré sur les endpoints d'authentification (login uniquement)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 tentatives / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // ne pénalise pas les login réussis
  // Le coach principal n'est jamais rate-limité au login
  skip: (req) => ((req.body?.email || '').toLowerCase() === MAIN_COACH_EMAIL),
  message: { error: 'too_many_auth_attempts', detail: 'Trop de tentatives. Réessaie dans 15 minutes.' },
});
// Rate-limit strict pour signup/forgot-password (toutes requêtes comptent, succès inclus)
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 8, // 8 signups / heure / IP
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_requests', detail: 'Trop de tentatives. Réessaie dans 1h.' },
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5, // 5 demandes / heure / IP
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_requests', detail: 'Trop de demandes de réinitialisation. Réessaie dans 1h.' },
});
// Rate-limit IA : par user (pas par IP) — 10 générations / heure, s'applique APRÈS authRequired
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id ? 'ai:' + req.user.id : 'ai:' + ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ai_rate_limit', detail: 'Limite de 10 générations IA par heure atteinte. Réessaie dans 1h.' },
});

// Redirect root to Muscu.html so https://prime-athl.onrender.com loads the app
// Root = landing page (index.html). L'app vit sur /Muscu.html.
// Le express.static plus bas servira automatiquement /index.html sur "/", mais on garde un fallback explicite :
app.get('/app', (req, res) => res.redirect('/Muscu.html'));
// Si build.js a généré Muscu.app.html (vanilla JS, sans Babel — bien plus rapide),
// on le sert à la place de Muscu.html. Sinon fallback sur la version source (Babel CDN).
const MUSCU_APP_BUILT = path.join(FRONTEND, 'Muscu.app.html');
app.get('/Muscu.html', (req, res, next) => {
  // HTML : revalidation systématique (le SW gère vraiment le cache offline)
  res.setHeader('Cache-Control', 'no-cache');
  fs.access(MUSCU_APP_BUILT, fs.constants.F_OK, (err) => {
    if (err) return next();
    res.sendFile(MUSCU_APP_BUILT);
  });
});

// Vendors immuables : cache 1 an (fichiers versionnés, jamais modifiés)
app.use('/vendor', express.static(path.join(FRONTEND, 'vendor'), {
  maxAge: '365d',
  immutable: true,
}));

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
  // Le coach principal n'est jamais verrouillé
  if ((user.email || '').toLowerCase() === MAIN_COACH_EMAIL) return;
  const now = Date.now();
  user.loginFails = (user.loginFails || []).filter(t => now - t < LOCK_WINDOW_MS);
  user.loginFails.push(now);
  if (user.loginFails.length >= LOCK_THRESHOLD) {
    user.lockedUntil = now + LOCK_WINDOW_MS;
  }
}
function isLocked(user) {
  // Le coach principal n'est jamais considéré comme verrouillé
  if (user && (user.email || '').toLowerCase() === MAIN_COACH_EMAIL) return false;
  return user && user.lockedUntil && user.lockedUntil > Date.now();
}
function clearLoginFailures(user) {
  if (user) { user.loginFails = []; user.lockedUntil = null; }
}

app.post('/api/auth/signup', signupLimiter, async (req, res) => {
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
      const INVITE_TTL = 30 * 24 * 3600 * 1000;
      if (!inv || inv.used || (Date.now() - inv.createdAt > INVITE_TTL)) return res.status(400).json({ error: 'invite_invalid' });
      coachId  = inv.coachId;
      userRole = 'athlete';
      inv.used = true;
      inv.usedAt = Date.now();
    }

    // Main coach is auto-promoted & active. Everyone else is pending.
    const status = isMain ? 'active' : 'pending';
    if (isMain) userRole = 'coach';

    const id = uid();
    const passwordHash = await bcrypt.hash(password, 12);
    const u = {
      id, email: lowEmail, passwordHash, role: userRole, coachId,
      firstName: '', lastName: '', height: '', weight: '', objective: '',
      prSquat: '', prBench: '', prDeadlift: '',
      createdAt: Date.now(),
      status, isMainCoach: isMain,
      loginFails: [], lockedUntil: null,
      requestedRole,
      tokenVersion: 0,
    };
    DATA.users[id] = u;
    persist();

    // Notify main coach of new pending request
    let coachDisplayName = null;
    if (!isMain) {
      const main = Object.values(DATA.users).find(x => x.isMainCoach && x.status === 'active');
      if (main) {
        coachDisplayName = [main.firstName, main.lastName].filter(Boolean).join(' ') || main.email.split('@')[0];
        io.to('user:' + main.id).emit('pending-request', { user: profileOf(u) });
        const athleteName = [u.firstName, u.lastName].filter(Boolean).join(' ') || lowEmail.split('@')[0];
        sendCoachNewAthleteEmail(main.email, lowEmail, athleteName).catch(e => console.error('[email] coach notify error:', e.message));
        // Push notification au coach (clic → onglet Coach)
        pushToUser(main.id, {
          title: '🆕 Nouvelle demande d\'inscription',
          body: `${athleteName} demande à rejoindre tes athlètes`,
          url: '/Muscu.html?tab=coach',
          tag: 'pending-' + u.id,
        });
      }
    }

    if (status === 'pending') {
      return res.json({
        pending: true,
        coachName: coachDisplayName,
        message: "Demande envoyée. En attente d'approbation du coach principal.",
      });
    }
    const token = signForUser(u);
    setAuthCookie(res, token);
    res.json({ token, user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'signup_failed' }); }
});

// Déblocage d'urgence du coach principal — accessible sans auth via token URL
const UNLOCK_SECRET = process.env.UNLOCK_SECRET || 'primeathl-unlock-coach-2024';
app.get('/api/auth/unlock-main-coach', (req, res) => {
  if (req.query.secret !== UNLOCK_SECRET) return res.status(403).json({ error: 'forbidden' });
  const main = Object.values(DATA.users).find(u => (u.email || '').toLowerCase() === MAIN_COACH_EMAIL);
  if (!main) return res.status(404).json({ error: 'main_coach_not_found' });
  main.loginFails = [];
  main.lockedUntil = null;
  main.status = 'active';
  try { persist(); } catch {}
  console.log('[unlock] Main coach manually unlocked');
  res.json({ ok: true, message: `Compte ${MAIN_COACH_EMAIL} débloqué. Tu peux te reconnecter.` });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = findUserByEmail((email || '').toLowerCase());
    // Réponse identique en temps constant si user inconnu (anti-énumération)
    if (!u) { await bcrypt.compare(password || '', '$2a$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhsh'); return res.status(401).json({ error: 'invalid_credentials' }); }
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
    const token = signForUser(u);
    setAuthCookie(res, token);
    res.json({ token, user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'login_failed' }); }
});

// Logout : efface le cookie httpOnly ET invalide le token JWT (tokenVersion++)
app.post('/api/auth/logout', (req, res) => {
  const cookieToken = req.cookies?.pa_token;
  const h = req.headers.authorization;
  const headerToken = h?.startsWith('Bearer ') ? h.slice(7) : null;
  const token = cookieToken || headerToken;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const u = DATA.users[decoded.id];
      if (u) {
        u.tokenVersion = (u.tokenVersion || 0) + 1;
        persist();
      }
    } catch { /* token déjà invalide ou expiré, rien à faire */ }
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ── Reset password ──────────────────────────────────
import crypto from 'crypto';
const RESET_TTL_MS = 60 * 60 * 1000; // 1h
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

// ── Envoi email centralisé ───────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email] (no RESEND_API_KEY) To: ${to} | Subject: ${subject}`);
    return { sent: false, reason: 'no_provider' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('[resend] HTTP', r.status, txt);
      let detail = '';
      try { detail = JSON.parse(txt).message || ''; } catch {}
      return { sent: false, reason: 'provider_error', status: r.status, detail };
    }
    console.log(`[email] ✓ sent to ${to} | ${subject}`);
    return { sent: true };
  } catch(e) { console.error('[resend] error:', e.message); return { sent: false, reason: 'network' }; }
}

const emailBase = (content) => `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a22;">
  <div style="margin-bottom:20px;"><span style="font-size:18px;font-weight:800;color:#d97757;">Prime Athl</span></div>
  ${content}
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;">Prime Athl · <a href="${PUBLIC_URL}" style="color:#d97757;">prime-athl.onrender.com</a></div>
</div>`;

const btn = (href, label) => `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;padding:12px 24px;background:#d97757;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">${label}</a></p>`;

async function sendResetEmail(toEmail, link) {
  return sendEmail({
    to: toEmail,
    subject: 'Prime Athl — Réinitialise ton mot de passe',
    html: emailBase(`
      <p>Tu as demandé à réinitialiser ton mot de passe.</p>
      ${btn(link, 'Choisir un nouveau mot de passe')}
      <p style="font-size:12px;color:#666;">Ce lien est valable <strong>1 heure</strong>. Si tu n'es pas à l'origine de cette demande, ignore ce message.</p>
      <p style="font-size:11px;color:#999;">Lien complet : ${link}</p>
    `),
  });
}

async function sendCoachNewAthleteEmail(coachEmail, athleteEmail, athleteName) {
  return sendEmail({
    to: coachEmail,
    subject: `Prime Athl — Nouvelle demande d'inscription : ${athleteName}`,
    html: emailBase(`
      <h2 style="font-size:20px;margin:0 0 10px;">Nouvelle demande d'inscription 🏋️</h2>
      <p><strong>${athleteName}</strong> (<a href="mailto:${athleteEmail}" style="color:#d97757;">${athleteEmail}</a>) vient de s'inscrire et attend ton approbation.</p>
      ${btn(`${PUBLIC_URL}/Muscu.html`, 'Ouvrir Prime Athl')}
      <p style="font-size:12px;color:#666;">Connecte-toi et va dans l'onglet <strong>Coach</strong> pour approuver ou refuser sa demande.</p>
    `),
  });
}

// Demande de réinitialisation — toujours réponse 200 pour éviter l'énumération d'emails
app.post('/api/auth/forgot-password', forgotLimiter, async (req, res) => {
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
    // Invalide tous les tokens existants (changement de mot de passe = déconnexion partout)
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    persist();
    const newToken = signForUser(u);
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

// ── Export RGPD : toutes les données personnelles de l'utilisateur ──────────
// Conforme au droit d'accès RGPD / CCPA — retourne un fichier JSON téléchargeable
app.get('/api/me/export', authRequired, (req, res) => {
  const uid = req.user.id;
  const u = DATA.users[uid];
  if (!u) return res.status(404).json({ error: 'not_found' });

  // On exclut les champs internes de sécurité (hash, tokens) jamais envoyés au client
  const { passwordHash, resetTokenHash, resetTokenExpiry, loginFails, lockedUntil, tokenVersion, ...publicUser } = u;

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: publicUser,
    sessions: Object.values(DATA.sessions).filter(s => s.userId === uid),
    weightLogs: DATA.weightLogs[uid] || [],
    nutritionLogs: DATA.nutritionLogs[uid] || {},
    freeFoodLogs: DATA.freeFoodLogs[uid] || {},
    nutritionProgram: DATA.nutritionPrograms[uid] || null,
    program: DATA.programs[uid] || null,
    savedPrograms: DATA.savedPrograms[uid] || [],
    myLibrary: DATA.myLibrary[uid] || { sessions: [], nutrition: [] },
    progressPhotos: (DATA.progressPhotos[uid] || []).map(p => ({ ...p, url: p.url?.startsWith('data:') ? '[base64 omis]' : p.url })),
    messages: Object.entries(DATA.messages)
      .filter(([key]) => key.includes(uid))
      .map(([key, msgs]) => ({ conversation: key, messages: msgs || [] })),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="prime-athl-mes-donnees-${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(exportData, null, 2));
});

const PROFILE_FIELDS = ['firstName','lastName','height','weight','objective','prSquat','prBench','prDeadlift'];

app.patch('/api/me', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const strFields = ['firstName','lastName','objective'];
  const numFields = { height:[50,300], weight:[20,500], prSquat:[0,1000], prBench:[0,1000], prDeadlift:[0,1000] };
  for (const k of strFields) {
    if (req.body[k] !== undefined) u[k] = String(req.body[k]).slice(0, 100);
  }
  for (const [k,[min,max]] of Object.entries(numFields)) {
    if (req.body[k] !== undefined) {
      const v = parseFloat(req.body[k]);
      if (!isNaN(v)) u[k] = Math.max(min, Math.min(max, v));
    }
  }
  if (req.body.avatarUrl !== undefined) {
    const v = String(req.body.avatarUrl || '').trim();
    if (!v) u.avatarUrl = '';
    else if (v.length <= 3 * 1024 * 1024 && /^(https?:\/\/|data:image\/)/.test(v)) u.avatarUrl = v;
    else return res.status(400).json({ error: 'invalid_avatar' });
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
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const all = Object.values(DATA.users)
    .filter(u => u.coachId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = all.length;
  const athletes = all.slice((page - 1) * limit, page * limit).map(u => {
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
  res.json({ athletes, total, page, limit, pages: Math.ceil(total / limit) });
});

app.get('/api/coach/athletes/:id', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const p = DATA.programs[u.id];
  const sessions = Object.values(DATA.sessions)
    .filter(s => s.userId === u.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 500);
  res.json({
    ...profileOf(u),
    program: p ? { data: p.data, assignedAt: p.assignedAt } : null,
    sessions: sessions.map(s => ({ id: s.id, date: s.date, name: s.name, totalVolume: s.totalVolume, exercises: s.exercises || [], rpe: s.rpe, notes: s.notes, duration: s.duration, coachFeedback: s.coachFeedback, coachFeedbackAt: s.coachFeedbackAt, createdByCoach: !!s.createdByCoach })),
  });
});

app.delete('/api/coach/athletes/:id', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  // Suppression complète du compte et toutes ses données
  delete DATA.users[u.id];
  delete DATA.programs[u.id];
  delete DATA.nutritionLogs[u.id];
  delete DATA.nutritionPrograms[u.id];
  delete DATA.weightLogs[u.id];
  delete DATA.progressPhotos[u.id];
  // Supprimer les séances (keyées par sessionId, pas userId)
  for (const sid of Object.keys(DATA.sessions || {})) {
    if (DATA.sessions[sid].userId === u.id) delete DATA.sessions[sid];
  }
  // Retirer des invites (DATA.invites est un objet keyé par code)
  for (const code of Object.keys(DATA.invites || {})) {
    if (DATA.invites[code].usedBy === u.id) delete DATA.invites[code];
  }
  persist();
  res.json({ deleted: true });
});

// Coach creates an athlete account directly (no approval needed)
app.post('/api/coach/create-athlete', authRequired, coachOnly, async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });
    if (password.length < 8) return res.status(400).json({ error: 'password_too_short', detail: 'Minimum 8 caractères.' });
    const lowEmail = email.toLowerCase().trim();
    if (findUserByEmail(lowEmail)) return res.status(409).json({ error: 'email_already_used' });

    const me = DATA.users[req.user.id];
    const id = uid();
    const passwordHash = await bcrypt.hash(password, 12);
    const u = {
      id, email: lowEmail, passwordHash, role: 'athlete',
      coachId: me.id,
      firstName: (firstName || '').trim(),
      lastName: (lastName || '').trim(),
      height: '', weight: '', objective: '',
      prSquat: '', prBench: '', prDeadlift: '',
      createdAt: Date.now(),
      status: 'active',
      isMainCoach: false,
      loginFails: [], lockedUntil: null,
      requestedRole: 'athlete',
      tokenVersion: 0,
    };
    DATA.users[id] = u;
    persist();
    res.json({ user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'create_athlete_failed' }); }
});

// All athletes without a coach (can be claimed by any coach)
app.get('/api/coach/available-athletes', authRequired, coachOnly, (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const all = Object.values(DATA.users)
    .filter(u => u.role === 'athlete' && !u.coachId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = all.length;
  const list = all.slice((page - 1) * limit, page * limit).map(u => {
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
  res.json({ athletes: list, total, page, limit, pages: Math.ceil(total / limit) });
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
// Peut aussi modifier email et password
app.patch('/api/coach/athletes/:id', authRequired, coachOnly, async (req, res) => {
  try {
    const u = DATA.users[req.params.id];
    if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
    for (const k of PROFILE_FIELDS) {
      if (req.body[k] !== undefined) {
        const val = String(req.body[k]).slice(0, 100);
        if (['height','weight','prSquat','prBench','prDeadlift'].includes(k)) {
          const n = parseFloat(val);
          u[k] = isNaN(n) ? '' : String(Math.max(0, Math.min(999, n)));
        } else {
          u[k] = val;
        }
      }
    }
    if (req.body.email) {
      const newEmail = req.body.email.toLowerCase().trim();
      const existing = findUserByEmail(newEmail);
      if (existing && existing.id !== u.id) return res.status(409).json({ error: 'email_already_used' });
      u.email = newEmail;
    }
    if (req.body.password) {
      if (req.body.password.length < 8) return res.status(400).json({ error: 'password_too_short', detail: 'Minimum 8 caractères.' });
      u.passwordHash = await bcrypt.hash(req.body.password, 12);
    }
    persist();
    const p = profileOf(u);
    io.to('user:' + u.id).emit('my-profile-updated', { profile: p });
    res.json(p);
  } catch (e) { res.status(500).json({ error: 'update_failed' }); }
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

// ── Programmes archivés ────────────────────────────────────────
// Sauvegarder le programme courant en archive
app.post('/api/my-program/save', authRequired, (req, res) => {
  const p = DATA.programs[req.user.id];
  if (!p || !p.data || !Object.keys(p.data).length) return res.status(400).json({ error: 'no_program' });
  const id = uid();
  const name = req.body?.name || ('Programme ' + new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }));
  if (!DATA.savedPrograms[req.user.id]) DATA.savedPrograms[req.user.id] = [];
  DATA.savedPrograms[req.user.id].unshift({ id, name, savedAt: Date.now(), data: p.data });
  // Garder max 5 archives par utilisateur
  if (DATA.savedPrograms[req.user.id].length > 5) DATA.savedPrograms[req.user.id] = DATA.savedPrograms[req.user.id].slice(0, 5);
  persist();
  res.json({ ok: true, id });
});

// Lister les programmes archivés
app.get('/api/my-program/saved', authRequired, (req, res) => {
  const saved = (DATA.savedPrograms[req.user.id] || []).map(s => ({
    id: s.id, name: s.name, savedAt: s.savedAt,
    sheets: Object.keys(s.data || {}),
    dayCount: Object.values(s.data || {}).reduce((n, sheet) => n + Object.keys(sheet).length, 0),
  }));
  res.json(saved);
});

// Récupérer un programme archivé complet (pour le voir ou le dupliquer)
app.get('/api/my-program/saved/:id', authRequired, (req, res) => {
  const saved = (DATA.savedPrograms[req.user.id] || []).find(s => s.id === req.params.id);
  if (!saved) return res.status(404).json({ error: 'not_found' });
  res.json(saved);
});

// Supprimer un programme archivé
app.delete('/api/my-program/saved/:id', authRequired, (req, res) => {
  if (!DATA.savedPrograms[req.user.id]) return res.json({ ok: true });
  DATA.savedPrograms[req.user.id] = DATA.savedPrograms[req.user.id].filter(s => s.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Restaurer (dupliquer) un programme archivé en programme courant
app.post('/api/my-program/restore/:id', authRequired, (req, res) => {
  const saved = (DATA.savedPrograms[req.user.id] || []).find(s => s.id === req.params.id);
  if (!saved) return res.status(404).json({ error: 'not_found' });
  const ts = Date.now();
  DATA.programs[req.user.id] = { data: saved.data, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + req.user.id).emit('program-updated', { data: saved.data, assignedAt: ts });
  res.json({ ok: true, assignedAt: ts });
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
  // Auto-archiver l'ancien programme avant de l'écraser
  const prev = DATA.programs[req.params.athleteId];
  if (prev && prev.data && Object.keys(prev.data).length > 0) {
    if (!DATA.savedPrograms[req.params.athleteId]) DATA.savedPrograms[req.params.athleteId] = [];
    const already = DATA.savedPrograms[req.params.athleteId];
    const autoName = 'Programme du ' + new Date(prev.assignedAt || ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    already.unshift({ id: Date.now().toString(36) + 'a', name: autoName, savedAt: Date.now(), data: prev.data });
    if (already.length > 5) DATA.savedPrograms[req.params.athleteId] = already.slice(0, 5);
  }
  DATA.programs[req.params.athleteId] = { data, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + req.params.athleteId).emit('program-updated', { data, assignedAt: ts });
  const coachName = DATA.users[req.user.id]?.firstName || 'Ton coach';
  pushToUser(req.params.athleteId, { title: '💪 Nouveau programme', body: `${coachName} t'a assigné un nouveau programme d'entraînement`, url: '/Muscu.html' });
  res.json({ ok: true, assignedAt: ts });
});

// ── Bibliothèque de séances (coach → athlète) ────────────────────────────────
// Le coach importe le même Excel mais les jours deviennent des séances
// indépendantes dans une bibliothèque — sans calendrier.

app.put('/api/coach/session-library/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const sessions = req.body?.sessions;
  if (!Array.isArray(sessions)) return res.status(400).json({ error: 'sessions_required' });
  const ts = Date.now();
  DATA.sessionLibrary[req.params.athleteId] = { sessions, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + req.params.athleteId).emit('session-library-updated', { sessions, assignedAt: ts });
  const coachName = DATA.users[req.user.id]?.firstName || 'Ton coach';
  pushToUser(req.params.athleteId, { title: '📚 Bibliothèque mise à jour', body: `${coachName} t'a partagé ${sessions.length} séance${sessions.length > 1 ? 's' : ''} dans ta bibliothèque`, url: '/Muscu.html' });
  res.json({ ok: true, assignedAt: ts });
});

app.get('/api/session-library', authRequired, (req, res) => {
  const lib = DATA.sessionLibrary[req.user.id];
  res.json(lib || { sessions: [], assignedAt: null, assignedBy: null });
});

app.get('/api/coach/session-library-for/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const lib = DATA.sessionLibrary[req.params.athleteId];
  res.json(lib || { sessions: [], assignedAt: null, assignedBy: null });
});

app.delete('/api/coach/session-library/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  delete DATA.sessionLibrary[req.params.athleteId];
  persist();
  io.to('user:' + req.params.athleteId).emit('session-library-updated', { sessions: [], assignedAt: null });
  res.json({ ok: true });
});

// ── Bibliothèque personnelle (programmes/plans générés par l'IA et importés) ─
const MY_LIBRARY_CAP = 10;

app.get('/api/my-library', authRequired, (req, res) => {
  const lib = DATA.myLibrary[req.user.id] || { sessions: [], nutrition: [] };
  res.json({ sessions: lib.sessions || [], nutrition: lib.nutrition || [] });
});

app.post('/api/my-library/sessions', authRequired, (req, res) => {
  const { name, muscles, tip, exercises } = req.body || {};
  if (!Array.isArray(exercises) || exercises.length === 0) return res.status(400).json({ error: 'exercises_required' });
  if (!DATA.myLibrary[req.user.id]) DATA.myLibrary[req.user.id] = { sessions: [], nutrition: [] };
  const lib = DATA.myLibrary[req.user.id];
  const id = uid();
  lib.sessions.unshift({ id, name: name || 'Programme IA', muscles: muscles || '', tip: tip || '', exercises, savedAt: Date.now() });
  if (lib.sessions.length > MY_LIBRARY_CAP) lib.sessions = lib.sessions.slice(0, MY_LIBRARY_CAP);
  persist();
  res.json({ ok: true, id });
});

app.delete('/api/my-library/sessions/:id', authRequired, (req, res) => {
  const lib = DATA.myLibrary[req.user.id];
  if (lib) { lib.sessions = (lib.sessions || []).filter(s => s.id !== req.params.id); persist(); }
  res.json({ ok: true });
});

app.post('/api/my-library/nutrition', authRequired, (req, res) => {
  const { name, plan } = req.body || {};
  if (!plan || !plan.days) return res.status(400).json({ error: 'plan_required' });
  if (!DATA.myLibrary[req.user.id]) DATA.myLibrary[req.user.id] = { sessions: [], nutrition: [] };
  const lib = DATA.myLibrary[req.user.id];
  const id = uid();
  lib.nutrition.unshift({ id, name: name || 'Plan nutrition IA', plan, savedAt: Date.now() });
  if (lib.nutrition.length > MY_LIBRARY_CAP) lib.nutrition = lib.nutrition.slice(0, MY_LIBRARY_CAP);
  persist();
  res.json({ ok: true, id });
});

app.delete('/api/my-library/nutrition/:id', authRequired, (req, res) => {
  const lib = DATA.myLibrary[req.user.id];
  if (lib) { lib.nutrition = (lib.nutrition || []).filter(n => n.id !== req.params.id); persist(); }
  res.json({ ok: true });
});

// Coach : lire la bibliothèque personnelle d'un athlète
app.get('/api/coach/athletes/:id/my-library', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.id];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const lib = DATA.myLibrary[req.params.id];
  res.json(lib || { sessions: [], nutrition: [] });
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

app.delete('/api/coach/invites/:code', authRequired, coachOnly, (req, res) => {
  const inv = DATA.invites[req.params.code];
  if (!inv || inv.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  if (inv.used) return res.status(400).json({ error: 'already_used' });
  delete DATA.invites[req.params.code];
  persist();
  res.json({ ok: true });
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
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 500)
    .map(s => ({ id: s.id, date: s.date, name: s.name, totalVolume: s.totalVolume, exercises: s.exercises || [], rpe: s.rpe, notes: s.notes, duration: s.duration, coachFeedback: s.coachFeedback, coachFeedbackAt: s.coachFeedbackAt, createdByCoach: !!s.createdByCoach }));
  res.json(list);
});

app.post('/api/sessions', authRequired, (req, res) => {
  const id = uid();
  const { date, name, totalVolume, exercises, rpe, notes, duration } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name_required' });
  const safeVolume = Math.max(0, Math.min(1e7, parseFloat(totalVolume) || 0));
  const safeExercises = (Array.isArray(exercises) ? exercises : []).slice(0, 50).map(ex => ({
    name: String(ex.name || '').slice(0, 100),
    muscle: String(ex.muscle || '').slice(0, 50),
    sets: (Array.isArray(ex.sets) ? ex.sets : []).slice(0, 30).map(s => ({
      weight: Math.max(0, Math.min(1000, parseFloat(s.weight) || 0)),
      reps: Math.max(0, Math.min(200, parseInt(s.reps) || 0)),
      done: !!s.done,
      note: s.note ? String(s.note).slice(0, 200) : undefined,
    })),
  }));
  const session = {
    id, userId: req.user.id,
    date: date || new Date().toISOString(),
    name: String(name).slice(0, 100),
    totalVolume: safeVolume,
    exercises: safeExercises,
  };
  if (rpe != null && !isNaN(parseFloat(rpe))) session.rpe = Math.min(10, Math.max(1, Math.round(parseFloat(rpe))));
  if (notes) session.notes = String(notes).slice(0, 500);
  if (duration) session.duration = Math.max(0, Math.min(600, parseInt(duration) || 0));
  DATA.sessions[id] = session;
  // Garder max 200 sessions par utilisateur (FIFO sur les plus vieilles)
  const userSids = Object.keys(DATA.sessions).filter(sid => DATA.sessions[sid].userId === userId);
  if (userSids.length > 200) {
    const sorted = userSids.sort((a, b) => new Date(DATA.sessions[a].date) - new Date(DATA.sessions[b].date));
    sorted.slice(0, userSids.length - 200).forEach(sid => delete DATA.sessions[sid]);
  }
  persist();

  const u = DATA.users[req.user.id];
  if (u?.coachId) {
    io.to('user:' + u.coachId).emit('session-added', {
      athleteId: req.user.id,
      session: { id, date: session.date, name, totalVolume },
    });
    const athleteName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email.split('@')[0];
    pushToUser(u.coachId, { title: '✅ Séance terminée', body: `${athleteName} vient de terminer "${session.name}"`, url: '/Muscu.html' });
  }
  res.json({ id });
});

// Athlète : supprimer une de ses propres séances
app.delete('/api/sessions/:id', authRequired, (req, res) => {
  const s = DATA.sessions[req.params.id];
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (s.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  delete DATA.sessions[req.params.id];
  persist();
  res.json({ ok: true });
});
app.delete('/api/coach/sessions/:sessionId', authRequired, coachOnly, (req, res) => {
  const s = DATA.sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: 'not_found' });
  const a = DATA.users[s.userId];
  if (!a || a.coachId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  delete DATA.sessions[req.params.sessionId];
  persist();
  io.to('user:' + s.userId).emit('session-deleted', { sessionId: req.params.sessionId });
  res.json({ ok: true });
});

// Coach feedback on athlete session
app.post('/api/coach/sessions/:sessionId/feedback', authRequired, coachOnly, (req, res) => {
  const s = DATA.sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: 'not_found' });
  const a = DATA.users[s.userId];
  if (!a || a.coachId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  s.coachFeedback = typeof req.body.feedback === 'string' ? req.body.feedback.slice(0, 500) : '';
  s.coachFeedbackAt = Date.now();
  persist();
  io.to('user:' + s.userId).emit('session-feedback', { sessionId: s.id, feedback: s.coachFeedback });
  res.json({ ok: true });
});

app.patch('/api/coach/sessions/:sessionId', authRequired, coachOnly, (req, res) => {
  const s = DATA.sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: 'not_found' });
  const a = DATA.users[s.userId];
  if (!a || a.coachId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (req.body.date) s.date = req.body.date;
  persist();
  io.to('user:' + s.userId).emit('session-moved', { sessionId: req.params.sessionId, date: s.date });
  res.json({ ok: true, date: s.date });
});

// Coach crée une séance pour un athlète (import à l'unité)
app.post('/api/coach/athletes/:id/sessions', authRequired, coachOnly, (req, res) => {
  const athlete = DATA.users[req.params.id];
  if (!athlete) return res.status(404).json({ error: 'not_found' });
  if (athlete.coachId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const { name, date, exercises, totalVolume, duration, notes } = req.body || {};
  if (!name || !Array.isArray(exercises)) return res.status(400).json({ error: 'name_and_exercises_required' });
  const id = 'cs-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const session = {
    id, userId: athlete.id,
    name: name.slice(0, 120),
    date: date || new Date().toISOString(),
    exercises: exercises.map(e => ({
      name: e.name || '', muscle: e.muscle || '',
      brand: e.brand ? String(e.brand).slice(0, 60) : '',
      groupId: e.groupId ? String(e.groupId).slice(0, 40) : '',
      groupType: ['classic','superset','triset'].includes(e.groupType) ? e.groupType : 'classic',
      sets: (e.sets || []).map(s => ({ weight: +s.weight || 0, reps: +s.reps || 0, rest: +s.rest || 0 })),
    })),
    totalVolume: +totalVolume || 0,
    duration: +duration || 0,
    notes: notes ? String(notes).slice(0, 500) : '',
    createdByCoach: true,
    createdAt: Date.now(),
  };
  DATA.sessions[id] = session;
  persist();
  io.to('user:' + athlete.id).emit('session-added', { session });
  io.to('user:' + req.user.id).emit('session-added', { session });
  res.json({ ok: true, id });
});

// ── Test email (main coach only) ────────────────────
app.post('/api/admin/test-email', authRequired, coachOnly, mainCoachOnly, async (req, res) => {
  const u = DATA.users[req.user.id];
  const to = String(req.body?.to || '').trim().toLowerCase() || u.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'invalid_email' });
  const result = await sendEmail({
    to,
    subject: 'Prime Athl — Test email ✅',
    html: emailBase(`
      <h2 style="font-size:20px;margin:0 0 10px;">Test réussi 🎉</h2>
      <p>Ton serveur d'emails Resend est correctement configuré.</p>
      <p style="font-size:13px;color:#666;">Expéditeur : <strong>${RESEND_FROM}</strong><br>Destinataire : <strong>${to}</strong><br>Date : ${new Date().toLocaleString('fr-FR')}</p>
    `),
  });
  res.json({ ...result, to });
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
      savedPrograms: body.savedPrograms || {},
      premiumCodes: body.premiumCodes || {},
      freeFoodLogs: body.freeFoodLogs || {},
      customFoods: body.customFoods || {},
      sessionLibrary: body.sessionLibrary || {},
      myLibrary: body.myLibrary || {},
    };
    persist();
    res.json({ ok: true, counts: {
      users: Object.keys(DATA.users).length,
      programs: Object.keys(DATA.programs).length,
      sessions: Object.keys(DATA.sessions).length,
      nutritionPrograms: Object.keys(DATA.nutritionPrograms).length,
      customFoods: Object.keys(DATA.customFoods).length,
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
      weightLogs: body.weightLogs || {},
      messages: body.messages || {},
      progressPhotos: body.progressPhotos || {},
      pushSubscriptions: body.pushSubscriptions || {},
      savedPrograms: body.savedPrograms || {},
      premiumCodes: body.premiumCodes || {},
      freeFoodLogs: body.freeFoodLogs || {},
      customFoods: body.customFoods || {},
      sessionLibrary: body.sessionLibrary || {},
      myLibrary: body.myLibrary || {},
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
  delete DATA.savedPrograms[u.id];
  delete DATA.myLibrary[u.id];
  delete DATA.users[u.id];
  persist();
  res.json({ ok: true, removed: true });
});

// ── Nutrition ───────────────────────────────────────
const ymd = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
// Parse une clé YYYY-MM-DD en timestamp local (évite le décalage UTC de new Date('YYYY-MM-DD'))
const ymdToLocal = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d).getTime(); };

// Charge le template nutrition depuis le fichier JSON généré à partir de l'Excel
let DEFAULT_NUTRITION;
try {
  const tplPath = path.join(__dirname, 'nutrition-template.json');
  DEFAULT_NUTRITION = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
  console.log('[nutrition] Template chargé:', DEFAULT_NUTRITION.dailyCalories + 'kcal');
} catch {
  DEFAULT_NUTRITION = { dailyCalories: 0, dailyProtein: 0, dailyCarbs: 0, dailyFat: 0, days: {} };
}

// Athlete fetches their nutrition plan + today's log + last 14 days
app.get('/api/nutrition', authRequired, (req, res) => {
  const plan = DATA.nutritionPrograms[req.user.id] || null;
  const logs = DATA.nutritionLogs[req.user.id] || {};
  const ff = (DATA.freeFoodLogs[req.user.id] || {});
  const today = ymd(Date.now());
  const todayLog = logs[today] || { validated: {}, validatedAt: {} };
  // 14-day history (logs + aliments libres)
  const history = {};
  for (let i = 0; i < 14; i++) {
    const d = ymd(Date.now() - i * 24*3600*1000);
    history[d] = { ...(logs[d] || { validated: {}, validatedAt: {} }), freeFoods: ff[d] || {} };
  }
  res.json({ plan, today: { date: today, ...todayLog, freeFoods: ff[today] || {} }, history });
});

// ── Aliments libres (logged ad hoc hors plan) ────────────────────────────────
// Structure: DATA.freeFoodLogs[userId][YYYY-MM-DD][mealId] = [{id,name,kcal,p,c,f,createdAt}]
app.post('/api/nutrition/free-food', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const { mealId, name, kcal, p, c, f, date } = req.body || {};
  if (!mealId || !name) return res.status(400).json({ error: 'meal_and_name_required' });
  if (String(name).length > 80) return res.status(400).json({ error: 'name_too_long' });
  const dateStr = date || ymd(Date.now());
  if (!DATA.freeFoodLogs[u.id]) DATA.freeFoodLogs[u.id] = {};
  if (!DATA.freeFoodLogs[u.id][dateStr]) DATA.freeFoodLogs[u.id][dateStr] = {};
  if (!DATA.freeFoodLogs[u.id][dateStr][mealId]) DATA.freeFoodLogs[u.id][dateStr][mealId] = [];
  const entry = {
    id: uid(),
    name: String(name).slice(0, 80),
    kcal: Math.max(0, parseFloat(kcal) || 0),
    p:    Math.max(0, parseFloat(p)    || 0),
    c:    Math.max(0, parseFloat(c)    || 0),
    f:    Math.max(0, parseFloat(f)    || 0),
    createdAt: Date.now(),
  };
  DATA.freeFoodLogs[u.id][dateStr][mealId].push(entry);
  persist();
  if (u.coachId) io.to('user:' + u.coachId).emit('nutrition-free-food-added', { athleteId: u.id, date: dateStr, mealId, entry });
  res.json({ ok: true, entry });
});

app.delete('/api/nutrition/free-food/:id', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const id = req.params.id;
  const userLogs = DATA.freeFoodLogs[u.id] || {};
  let removed = false;
  for (const dateStr of Object.keys(userLogs)) {
    for (const mealId of Object.keys(userLogs[dateStr])) {
      const arr = userLogs[dateStr][mealId];
      const idx = arr.findIndex(e => e.id === id);
      if (idx >= 0) {
        arr.splice(idx, 1);
        removed = true;
        if (u.coachId) io.to('user:' + u.coachId).emit('nutrition-free-food-removed', { athleteId: u.id, date: dateStr, mealId, id });
        break;
      }
    }
    if (removed) break;
  }
  if (!removed) return res.status(404).json({ error: 'not_found' });
  persist();
  res.json({ ok: true });
});

// ── Base d'aliments (custom + Open Food Facts) ───────────────────────────────
// Normalise une chaîne pour comparaison search (sans accents, lowercase, trim)
const normFoodName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// GET /api/foods/search?q=...&page=1&limit=12
// Cherche d'abord dans customFoods (instant), puis enrichit avec Open Food Facts.
app.get('/api/foods/search', authRequired, async (req, res) => {
  const q = normFoodName(req.query.q);
  if (q.length < 2) return res.json({ results: [], total: 0, page: 1, pages: 1 });
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));

  // 1. Recherche locale customFoods
  const u = DATA.users[req.user.id];
  const visibleFoods = Object.values(DATA.customFoods).filter(f =>
    f.isPublic || f.coachId === req.user.id || (u && u.coachId && f.coachId === u.coachId)
  );
  const localResults = visibleFoods
    .filter(f => normFoodName(f.name).includes(q))
    .map(f => ({
      id: f.id,
      source: f.source === 'creole' ? 'creole' : 'custom',
      name: f.name,
      kcal: f.kcalPer100g, p: f.pPer100g, c: f.cPer100g, f: f.fPer100g,
    }));

  // 2. Open Food Facts (timeout 3s, fallback silencieux si réseau lent/HS)
  let offResults = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const offPage = Math.max(1, page - Math.ceil(localResults.length / limit));
    const url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(q)}&fields=product_name,product_name_fr,nutriments&page_size=12&page=${offPage}&lang=fr`;
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'PrimeAthl/1.0' } });
    clearTimeout(timeout);
    if (r.ok) {
      const data = await r.json();
      offResults = (data.products || [])
        .filter(p => p.nutriments && p.nutriments['energy-kcal_100g'] != null)
        .map(p => ({
          id: 'off:' + (p.code || Math.random().toString(36).slice(2)),
          source: 'off',
          name: p.product_name_fr || p.product_name || 'Produit inconnu',
          kcal: Math.round(p.nutriments['energy-kcal_100g'] || 0),
          p:    Math.round((p.nutriments['proteins_100g']      || 0) * 10) / 10,
          c:    Math.round((p.nutriments['carbohydrates_100g'] || 0) * 10) / 10,
          f:    Math.round((p.nutriments['fat_100g']           || 0) * 10) / 10,
        }))
        .filter(p => p.kcal > 0);
    }
  } catch (e) { /* timeout ou erreur réseau — ignoré, on retourne seulement le local */ }

  const all = [...localResults, ...offResults];
  const total = all.length;
  const results = all.slice((page - 1) * limit, page * limit);
  res.json({ results, total, page, limit, pages: Math.ceil(total / limit) || 1 });
});

// POST /api/foods : un coach crée un aliment custom (visible par ses athlètes)
app.post('/api/foods', authRequired, coachOnly, (req, res) => {
  const { name, kcal, p, c, f, isPublic } = req.body || {};
  if (!name || name.length < 2) return res.status(400).json({ error: 'name_required' });
  if (kcal == null || +kcal < 0) return res.status(400).json({ error: 'kcal_required' });
  const id = Math.random().toString(36).slice(2,10) + Date.now().toString(36);
  DATA.customFoods[id] = {
    id,
    coachId: req.user.id,
    name: String(name).slice(0, 80),
    nameNormalized: normFoodName(name),
    kcalPer100g: Math.max(0, parseFloat(kcal) || 0),
    pPer100g:    Math.max(0, parseFloat(p)    || 0),
    cPer100g:    Math.max(0, parseFloat(c)    || 0),
    fPer100g:    Math.max(0, parseFloat(f)    || 0),
    isPublic: !!isPublic,
    isSeed: false,
    source: 'custom',
    createdAt: Date.now(),
  };
  persist();
  res.json({ ok: true, food: DATA.customFoods[id] });
});

// DELETE /api/foods/:id : seul le coach créateur peut supprimer son aliment
app.delete('/api/foods/:id', authRequired, coachOnly, (req, res) => {
  const food = DATA.customFoods[req.params.id];
  if (!food) return res.status(404).json({ error: 'not_found' });
  if (food.coachId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (food.isSeed) return res.status(403).json({ error: 'cannot_delete_seed' });
  delete DATA.customFoods[req.params.id];
  persist();
  res.json({ ok: true });
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

// Athlete rates their nutrition day (1-5 stars)
app.post('/api/nutrition/rate', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const { date, rating } = req.body || {};
  const dateStr = date || ymd(Date.now());
  const r = parseInt(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'invalid_rating' });
  if (!DATA.nutritionLogs[u.id]) DATA.nutritionLogs[u.id] = {};
  if (!DATA.nutritionLogs[u.id][dateStr]) DATA.nutritionLogs[u.id][dateStr] = { validated: {}, validatedAt: {} };
  DATA.nutritionLogs[u.id][dateStr].rating = r;
  persist();
  if (u.coachId) io.to('user:' + u.coachId).emit('nutrition-rated', { athleteId: u.id, date: dateStr, rating: r });
  res.json({ ok: true, rating: r });
});

// Coach copies a nutrition day to another date
app.post('/api/nutrition/copy-day', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const { fromDate, toDate, validatedEntries } = req.body || {};
  if (!fromDate || !toDate) return res.status(400).json({ error: 'dates_required' });
  if (!DATA.nutritionLogs[u.id]) DATA.nutritionLogs[u.id] = {};
  // Copy the validated entries from source to target
  const srcLog = DATA.nutritionLogs[u.id][fromDate] || {};
  DATA.nutritionLogs[u.id][toDate] = {
    validated: { ...(validatedEntries || srcLog.validated || {}) },
    validatedAt: Object.fromEntries(Object.entries(validatedEntries || srcLog.validated || {}).map(([k,v]) => [k, v ? Date.now() : null])),
    copiedFrom: fromDate,
  };
  persist();
  res.json({ ok: true });
});

// User imports / updates their OWN nutrition plan (coach for himself, or athlete without coach)
app.put('/api/my-nutrition', authRequired, (req, res) => {
  const plan = req.body && req.body.plan ? req.body.plan : null;
  if (!plan) return res.status(400).json({ error: 'plan_required' });
  if (JSON.stringify(plan).length > 2 * 1024 * 1024) return res.status(413).json({ error: 'plan_too_large' });
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
  // No push here — push is sent only on explicit validation via POST .../notify
  res.json({ ok: true, assignedAt: ts });
});

// Coach validates and notifies athlete of nutrition plan
app.post('/api/coach/nutrition/:athleteId/notify', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const coachName = DATA.users[req.user.id]?.firstName || 'Ton coach';
  pushToUser(a.id, { title: '🥗 Plan nutrition validé', body: `${coachName} a finalisé ton plan nutrition — consulte-le maintenant !`, url: '/Muscu.html' });
  res.json({ ok: true });
});

// Coach fetches athlete's nutrition (plan + history)
// ── Coach calendar — vue globale tous athlètes ────────────
app.get('/api/coach/calendar', authRequired, coachOnly, (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1; // 1-12
  // Marge de ±24h pour ne pas exclure les séances proches des limites du mois
  // selon le fuseau horaire local du coach (le serveur tourne en UTC).
  const start = new Date(year, month - 1, 1).getTime() - 24*3600*1000;
  const end   = new Date(year, month, 1).getTime() + 24*3600*1000;
  const JS_TO_DAY = ['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'];
  const PALETTE = ['#d97757','#7cc4a1','#7ca8c4','#c97586','#c2a042','#a08fd4','#78b4b4'];

  const athletes = Object.values(DATA.users)
    .filter(u => u.coachId === req.user.id && u.role === 'athlete');

  const result = athletes.map((u, idx) => {
    // Sessions du mois
    // On renvoie les timestamps ISO bruts (et non une date UTC pré-découpée) :
    // seul le frontend connaît le fuseau horaire local du coach et peut donc
    // regrouper correctement les séances par "jour local" via ymdKey().
    const sessionDates = Object.values(DATA.sessions)
      .filter(s => s.userId === u.id && new Date(s.date).getTime() >= start && new Date(s.date).getTime() < end)
      .map(s => s.date);

    // Nutrition validée du mois (nutritionLogs)
    const logs = DATA.nutritionLogs[u.id] || {};
    const nutriDates = Object.keys(logs).filter(dateStr => {
      // ymdToLocal : parse YYYY-MM-DD en heure locale, cohérent avec start/end (new Date(year, month-1, 1))
      const d = ymdToLocal(dateStr);
      return d >= start && d < end && Object.values(logs[dateStr]?.validated||{}).some(v => v);
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

  // Per-day volumes Mon(0)–Sun(6) for current week
  const weekDayVolumes = [0,0,0,0,0,0,0];
  const startOfWeek = new Date(); startOfWeek.setHours(0,0,0,0);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay()+6)%7));
  for (const s of sessions) {
    const d = new Date(s.date);
    if (d >= startOfWeek) weekDayVolumes[(d.getDay()+6)%7] += s.totalVolume || 0;
  }

  // Streak: consecutive days with ≥1 session (start from yesterday if no session today)
  const sessionDaySet = new Set(sessions.map(s => { const d=new Date(s.date); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }));
  let streak = 0;
  const cur = new Date(); cur.setHours(0,0,0,0);
  const todayKey = `${cur.getFullYear()}-${cur.getMonth()+1}-${cur.getDate()}`;
  if (!sessionDaySet.has(todayKey)) cur.setDate(cur.getDate()-1);
  while (true) {
    const k = `${cur.getFullYear()}-${cur.getMonth()+1}-${cur.getDate()}`;
    if (sessionDaySet.has(k)) { streak++; cur.setDate(cur.getDate()-1); } else break;
  }

  // Find next day in program
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
    weekStats: { sessions: sessions.filter(s => new Date(s.date) >= startOfWeek).length, volume: Math.round(weekDayVolumes.reduce((a,b)=>a+b,0)) },
    weekDayVolumes: weekDayVolumes.map(v => Math.round(v)),
    streak,
    prs: { squat: u.prSquat || null, bench: u.prBench || null, deadlift: u.prDeadlift || null },
  });
});

// ── My coach info (for athlete) ─────────────────────
app.get('/api/my-coach', authRequired, (req, res) => {
  const me = DATA.users[req.user.id];
  if (!me || !me.coachId) return res.status(404).json({ error: 'no_coach' });
  const coach = DATA.users[me.coachId];
  if (!coach) return res.status(404).json({ error: 'coach_not_found' });
  res.json({ id: coach.id, email: coach.email, firstName: coach.firstName, lastName: coach.lastName, role: coach.role, avatarUrl: coach.avatarUrl || '' });
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
  // Garder max 365 entrées de poids par user
  const MAX_WEIGHT = 365;
  if (DATA.weightLogs[req.user.id].length > MAX_WEIGHT) DATA.weightLogs[req.user.id] = DATA.weightLogs[req.user.id].slice(-MAX_WEIGHT);
  persist();
  const count = DATA.weightLogs[req.user.id].length;
  res.json({ ok: true, entry, nearLimit: count >= MAX_WEIGHT - 10, count, max: MAX_WEIGHT });
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
const ALLOWED_UPLOAD_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  if (!ALLOWED_UPLOAD_MIMES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'invalid_file_type' });
  }
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
  // Fallback base64 si Cloudinary non configuré — limité à 500KB pour ne pas gonfler la DB
  if (req.file.buffer.length > 500 * 1024) return res.status(400).json({ error: 'upload_failed', detail: 'Configure Cloudinary pour les photos > 500KB.' });
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

// Vérifie que 2 users sont bien en relation coach↔athlete
function canChat(userA, userB) {
  if (!userA || !userB) return false;
  if (userA.role === 'coach' && userB.coachId === userA.id) return true;
  if (userB.role === 'coach' && userA.coachId === userB.id) return true;
  if (userA.isMainCoach || userB.isMainCoach) return true;
  return false;
}

app.get('/api/messages/:partnerId', authRequired, (req, res) => {
  const me = req.user.id;
  const partner = req.params.partnerId;
  const meUser = DATA.users[me];
  const partnerUser = DATA.users[partner];
  if (!partnerUser) return res.status(404).json({ error: 'not_found' });
  if (!canChat(meUser, partnerUser)) return res.status(403).json({ error: 'forbidden' });
  const key = chatId(me, partner);
  const msgs = (DATA.messages[key] || []).slice().sort((a,b) => a.createdAt - b.createdAt);
  res.json({ messages: msgs });
});

app.post('/api/messages/:partnerId', authRequired, (req, res) => {
  const me = req.user.id;
  const partner = req.params.partnerId;
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text_required' });
  if (text.trim().length > 2000) return res.status(400).json({ error: 'message_too_long', detail: 'Maximum 2000 caractères.' });
  const meUser = DATA.users[me];
  const partnerUser = DATA.users[partner];
  if (!partnerUser) return res.status(404).json({ error: 'not_found' });
  if (!canChat(meUser, partnerUser)) return res.status(403).json({ error: 'forbidden' });
  const key = chatId(me, partner);
  const msg = { id: uid(), senderId: me, text: text.trim(), createdAt: Date.now() };
  if (!DATA.messages[key]) DATA.messages[key] = [];
  DATA.messages[key].push(msg);
  // Garder max 200 messages par conversation
  if (DATA.messages[key].length > 200) DATA.messages[key] = DATA.messages[key].slice(-200);
  persist();
  // Emit to both participants
  io.to('user:' + partner).emit('new-message', { from: me, msg });
  io.to('user:' + me).emit('new-message', { from: me, msg });
  // Push notification to partner if subscribed
  const sub = DATA.pushSubscriptions[partner];
  console.log('[push-msg] partner=', partner, 'hasSub=', !!sub, 'hasVapid=', !!VAPID_PUBLIC_KEY);
  if (sub && VAPID_PUBLIC_KEY) {
    const sender = DATA.users[me];
    const name = sender?.firstName || sender?.email?.split('@')[0] || 'Athlète';
    webpush.sendNotification(sub, JSON.stringify({
      title: `💬 ${name}`,
      body: text.trim().slice(0, 100),
      tag: `msg-${me}`,
      icon: PUSH_ICON,
      badge: PUSH_BADGE,
      url: '/Muscu.html'
    })).then(() => console.log('[push-msg] sent OK'))
      .catch(e => {
        console.error('[push-msg] error:', e.statusCode, e.message);
        if (e.statusCode === 410 || e.statusCode === 404) {
          const old = DATA.pushSubscriptions[partner];
          if (old) { DATA.pushSubscriptions[partner] = { ...old, invalidatedAt: Date.now() }; persist(); }
        }
      });
  }
  res.json({ ok: true, msg });
});

// ── Push helper ──────────────────────────────────────
const PUSH_ICON = '/push-icon.webp';
const PUSH_BADGE = '/icon-192.png';
function pushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY) return;
  const sub = DATA.pushSubscriptions[userId];
  if (!sub || sub.invalidatedAt) return;
  const enriched = { icon: PUSH_ICON, badge: PUSH_BADGE, ...payload };
  webpush.sendNotification(sub, JSON.stringify(enriched))
    .catch(e => {
      if (e.statusCode === 410 || e.statusCode === 404) {
        // Subscription expirée — marquer pour nettoyage différé (pas de suppress immédiat)
        DATA.pushSubscriptions[userId] = { ...sub, invalidatedAt: Date.now() };
        persist();
      }
    });
}

// ── IA — Nutrition helpers ───────────────────────────
const AI_MEAL_TEMPLATES = {
  3:[{id:'breakfast',label:'Petit-déjeuner',emoji:'🍳',timeStart:'07:00',timeEnd:'09:00'},{id:'lunch',label:'Déjeuner',emoji:'🍱',timeStart:'12:00',timeEnd:'14:00'},{id:'dinner',label:'Dîner',emoji:'🍝',timeStart:'19:00',timeEnd:'21:00'}],
  4:[{id:'breakfast',label:'Petit-déjeuner',emoji:'🍳',timeStart:'07:00',timeEnd:'09:00'},{id:'snack1',label:'Collation',emoji:'🥜',timeStart:'10:30',timeEnd:'11:30'},{id:'lunch',label:'Déjeuner',emoji:'🍱',timeStart:'12:00',timeEnd:'14:00'},{id:'dinner',label:'Dîner',emoji:'🍝',timeStart:'19:00',timeEnd:'21:00'}],
  5:[{id:'breakfast',label:'Petit-déjeuner',emoji:'🍳',timeStart:'07:00',timeEnd:'09:00'},{id:'snack1',label:'Collation matin',emoji:'🥜',timeStart:'10:00',timeEnd:'11:00'},{id:'lunch',label:'Déjeuner',emoji:'🍱',timeStart:'12:00',timeEnd:'14:00'},{id:'snack2',label:'Collation',emoji:'🍎',timeStart:'16:00',timeEnd:'17:00'},{id:'dinner',label:'Dîner',emoji:'🍝',timeStart:'19:00',timeEnd:'21:00'}],
  6:[{id:'breakfast',label:'Petit-déjeuner',emoji:'🍳',timeStart:'07:00',timeEnd:'09:00'},{id:'snack1',label:'Collation matin',emoji:'🥜',timeStart:'10:00',timeEnd:'11:00'},{id:'lunch',label:'Déjeuner',emoji:'🍱',timeStart:'12:00',timeEnd:'14:00'},{id:'snack2',label:'Collation',emoji:'🍎',timeStart:'16:00',timeEnd:'17:00'},{id:'dinner',label:'Dîner',emoji:'🍝',timeStart:'19:00',timeEnd:'21:00'},{id:'eveningSnack',label:'Collation soir',emoji:'🥛',timeStart:'21:00',timeEnd:'22:00'}],
};

function calcNutritionTargets({ gender, age, weight, height, activity, goal }) {
  const bmr = gender === 'Homme'
    ? 10*weight + 6.25*height - 5*age + 5
    : 10*weight + 6.25*height - 5*age - 161;
  const act = { 'Sédentaire':1.2,'Légèrement actif':1.375,'Modérément actif':1.55,'Très actif':1.725,'Extrêmement actif':1.9 }[activity] || 1.55;
  const tdee = Math.round(bmr * act);
  const calMult = { 'Prise de masse':1.12,'Sèche':0.82,'Maintien':1.0,'Rééquilibrage':0.90 }[goal] || 1.0;
  const cals = Math.round(tdee * calMult);
  const r = { 'Prise de masse':{p:0.30,c:0.45,f:0.25},'Sèche':{p:0.38,c:0.32,f:0.30},'Maintien':{p:0.28,c:0.45,f:0.27},'Rééquilibrage':{p:0.33,c:0.40,f:0.27} }[goal] || {p:0.30,c:0.45,f:0.25};
  return { calories:cals, protein:Math.round(cals*r.p/4), carbs:Math.round(cals*r.c/4), fat:Math.round(cals*r.f/9) };
}

function enrichAIPlan(rawDays, mealsPerDay, targets) {
  const templates = AI_MEAL_TEMPLATES[mealsPerDay] || AI_MEAL_TEMPLATES[3];
  const DAYS = ['LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI','DIMANCHE'];
  const days = {};
  for (const day of DAYS) {
    const raw = rawDays[day];
    const meals = templates.map((tpl, i) => {
      const items = (raw?.meals?.[i]?.items || []).map(it => ({
        name:String(it.name||'').trim(), qty:Number(it.qty)||0, unit:String(it.unit||'g'),
        kcal:Number(it.kcal)||0, p:Number(it.p)||0, c:Number(it.c)||0, f:Number(it.f)||0,
      }));
      return { ...tpl, items, note:'' };
    });
    days[day] = { meals };
  }
  return { dailyCalories:targets.calories, dailyProtein:targets.protein, dailyCarbs:targets.carbs, dailyFat:targets.fat, days };
}

// ── Liste de produits Prime Athl (base Michel + Yohan) ──────────────────────
const PRIME_ATHL_PRODUCTS = [
  'Blanc de poulet','Poulet (filet/cuisse)','Steak','Sardines en boîte','Thon en boîte',
  'Œuf entier','Œufs durs','Fromage blanc 0%','Yaourt sport','Petit suisse','Whey protéine',
  "Flocons d'avoine","Galette d'épeautre",'Riz blanc','Pomme de terre','Patate douce',
  'Lentilles','Haricots rouges','Dattes','Haricots verts','Brocoli','Mâche / roquette',
  'Banane','Pomme','Kiwi','Fruits rouges',
  "Huile d'olive",'Beurre de cacahuète','Graines de chia','Chocolat noir 70%','Miel',
];

// ── IA — Helpers de validation JSON ─────────────────
const AI_DAYS = ['LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI','DIMANCHE'];

function validateAINutritionDays(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Réponse IA invalide : structure manquante');
  if (!parsed.days || typeof parsed.days !== 'object') throw new Error('Réponse IA invalide : champ "days" manquant');
  for (const day of AI_DAYS) {
    if (!parsed.days[day] || typeof parsed.days[day] !== 'object') {
      parsed.days[day] = { meals: [] };
    }
    if (!Array.isArray(parsed.days[day].meals)) parsed.days[day].meals = [];
  }
  return parsed;
}

function validateAIMealItems(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Réponse IA invalide : structure manquante');
  if (!Array.isArray(parsed.items)) throw new Error('Réponse IA invalide : champ "items" manquant ou non-tableau');
  return parsed;
}

function validateAIProgram(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Réponse IA invalide : structure manquante');
  if (!parsed.name || typeof parsed.name !== 'string') throw new Error('Réponse IA invalide : champ "name" manquant');
  if (!Array.isArray(parsed.exercises)) throw new Error('Réponse IA invalide : champ "exercises" manquant ou non-tableau');
  if (parsed.exercises.length === 0) throw new Error('Réponse IA invalide : aucun exercice généré');
  return parsed;
}

// ── IA — Génération de plan nutrition 7 jours ───────
app.post('/api/ai/generate-nutrition', authRequired, aiLimiter, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ai_not_configured' });
  const { gender, age, weight, height, activity, goal, mealsPerDay=3, allergies='',
          targetCalories, targetProtein, targetCarbs, targetFat, useProductList=false } = req.body || {};
  if (!gender || !age || !weight || !height || !activity || !goal) return res.status(400).json({ error: 'missing_fields' });
  let targets;
  if (targetCalories && targetProtein && targetCarbs && targetFat) {
    targets = { calories:Number(targetCalories), protein:Number(targetProtein), carbs:Number(targetCarbs), fat:Number(targetFat) };
  } else if (targetCalories) {
    const c=Number(targetCalories); const r={p:0.30,c:0.45,f:0.25};
    targets = { calories:c, protein:Math.round(c*r.p/4), carbs:Math.round(c*r.c/4), fat:Math.round(c*r.f/9) };
  } else {
    targets = calcNutritionTargets({ gender, age:Number(age), weight:Number(weight), height:Number(height), activity, goal });
  }
  const mealCount = Math.min(6, Math.max(3, Number(mealsPerDay)));
  const mealNames = (AI_MEAL_TEMPLATES[mealCount]||AI_MEAL_TEMPLATES[3]).map(t=>t.label).join(', ');
  const productConstraint = useProductList
    ? `\nALIMENTS AUTORISÉS — utilise UNIQUEMENT cette liste (adapte les quantités librement): ${PRIME_ATHL_PRODUCTS.join(' | ')}.`
    : '\nAliments variés du supermarché français.';
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 7000,
      messages: [{ role: 'user', content: `Nutritionniste expert. Plan nutrition 7 jours en JSON pur (sans markdown).

Cibles/jour: ${targets.calories}kcal | P:${targets.protein}g G:${targets.carbs}g L:${targets.fat}g
Repas (${mealCount}/j): ${mealNames}
Contraintes: allergies=${allergies||'aucune'} | objectif=${goal}${productConstraint}
Variété: varie les protéines ET les associations d'aliments d'un repas/jour à l'autre — n'accouple pas systématiquement les deux mêmes aliments (ex: éviter "flocons d'avoine + fromage blanc" à chaque fois qu'il y a des flocons d'avoine).
Unités réalistes selon l'aliment : "unité"/"pièce" pour un fruit entier (pomme, banane, kiwi…) ou un œuf, "boîte" pour une conserve (sardines, thon…), "tranche" si pertinent, "g"/"ml" sinon. N'utilise pas "g" pour tout par défaut.

Format EXACT (pas de texte autour), exemple d'unités variées :
{"days":{"LUNDI":{"meals":[{"items":[{"name":"Flocons d'avoine","qty":80,"unit":"g","kcal":296,"p":10,"c":54,"f":6},{"name":"Banane","qty":1,"unit":"unité","kcal":90,"p":1,"c":23,"f":0}]},{"items":[{"name":"Sardines en boîte","qty":1,"unit":"boîte","kcal":180,"p":20,"c":0,"f":11},{"name":"Riz blanc","qty":150,"unit":"g","kcal":195,"p":4,"c":42,"f":0}]}]},"MARDI":{...},"MERCREDI":{...},"JEUDI":{...},"VENDREDI":{...},"SAMEDI":{...},"DIMANCHE":{...}}}
Chaque jour: exactement ${mealCount} repas. Items: EXACTEMENT 2-3 aliments par repas (pas plus). Macros cohérentes. IMPORTANT: termine le JSON complètement, tous les 7 jours.` }]
    });
    const block0 = msg.content?.find(b => b.type === 'text');
    if (!block0) throw new Error('Réponse IA vide');
    let raw = block0.text.trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(parseErr) {
      // Tentative de réparation : JSON tronqué par la limite de tokens
      const lastBracket = raw.lastIndexOf(']}');
      if (lastBracket === -1) throw new Error('Réponse IA illisible — JSON tronqué');
      let repaired = raw.slice(0, lastBracket + 2) + ']}}}';
      try { parsed = JSON.parse(repaired); } catch { throw new Error('Réponse IA illisible — réparation impossible'); }
    }
    validateAINutritionDays(parsed);
    const plan = enrichAIPlan(parsed.days, mealCount, targets);
    res.json({ targets, plan });
  } catch(e) {
    console.error('AI nutrition error:', e.message);
    res.status(500).json({ error: 'generation_failed', detail: e.message });
  }
});

// ── IA — Régénérer un repas ──────────────────────────
app.post('/api/ai/regenerate-meal', authRequired, aiLimiter, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ai_not_configured' });
  const { day, dayLabel, mealLabel, targetKcal, targetProtein, allergies, goal } = req.body || {};
  const dayName = day || dayLabel || '';
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Régénère le repas "${mealLabel}" du ${dayName}, avec une association d'aliments différente de l'habituelle (varie les duos, ex: évite systématiquement "flocons d'avoine + fromage blanc").
Budget: ~${targetKcal} kcal, ~${targetProtein}g protéines | Objectif: ${goal} | Allergies: ${allergies||'aucune'}
Unités réalistes selon l'aliment : "unité"/"pièce" pour un fruit entier ou un œuf, "boîte" pour une conserve, "tranche" si pertinent, "g"/"ml" sinon (pas "g" pour tout par défaut).
Réponds UNIQUEMENT en JSON sans markdown, EXACTEMENT 2-3 aliments : {"items":[{"name":"Banane","qty":1,"unit":"unité","kcal":90,"p":1,"c":23,"f":0},{"name":"...","qty":100,"unit":"g","kcal":120,"p":10,"c":15,"f":3}]}` }]
    });
    const block = msg.content?.find(b => b.type === 'text');
    if (!block) throw new Error('Réponse IA vide');
    const raw = block.text.trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
    const parsed = validateAIMealItems(JSON.parse(raw));
    res.json({ items: parsed.items.map(it=>({name:String(it.name||'').trim(),qty:Number(it.qty)||0,unit:String(it.unit||'g'),kcal:Number(it.kcal)||0,p:Number(it.p)||0,c:Number(it.c)||0,f:Number(it.f)||0})) });
  } catch(e) {
    console.error('AI regen meal error:', e.message);
    res.status(500).json({ error: 'regeneration_failed', detail: e.message });
  }
});

// ── IA — Génération de programme ────────────────────
app.post('/api/ai/generate-program', authRequired, aiLimiter, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ai_not_configured' });
  const { level, goal, days, equipment, gender, age, weight, height } = req.body || {};
  if (!level || !goal || !days || !equipment) return res.status(400).json({ error: 'missing_fields' });
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const profileExtra = [
      gender && `- Genre : ${gender}`,
      age && `- Âge : ${age} ans`,
      weight && `- Poids : ${weight} kg`,
      height && `- Taille : ${height} cm`,
    ].filter(Boolean).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: `Tu es un coach sportif expert. Génère une séance d'entraînement adaptée :
- Niveau : ${level}
- Objectif : ${goal}
- Jours dispo par semaine : ${days}
- Équipement : ${equipment}${profileExtra?'\n'+profileExtra:''}

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de backticks) dans ce format exact :
{"name":"Nom de la séance","muscles":"Groupes musculaires","tip":"Conseil global en 1 phrase","exercises":[{"name":"Nom exercice","muscle":"Groupe musculaire","sets":3,"reps":"10-12","rest":"60s","tip":"Conseil technique en 1 phrase courte"}]}

Génère 5 à 7 exercices. Débutant = exercices simples avec machines/guidés. Avancé = mouvements composés lourds. Adapte les séries/reps à l'objectif (masse=6-10 reps lourds, sèche=12-15 reps légers, force=3-5 reps max).` }]
    });
    const block1 = msg.content?.find(b => b.type === 'text');
    if (!block1) throw new Error('Réponse IA vide');
    const raw = block1.text.trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
    const program = validateAIProgram(JSON.parse(raw));
    res.json({ program });
  } catch(e) {
    console.error('AI generate error:', e.message);
    res.status(500).json({ error: 'generation_failed', detail: e.message });
  }
});

// ── Push subscriptions ────────────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY || null });
});

app.get('/api/push/status', authRequired, (req, res) => {
  const sub = DATA.pushSubscriptions[req.user.id];
  res.json({ subscribed: !!sub, endpoint: sub?.endpoint?.slice(0, 50) || null, vapidConfigured: !!VAPID_PUBLIC_KEY });
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
  try {
    socket.user = verify(token);
    const u = DATA.users[socket.user.id];
    if (!u) return next(new Error('user_not_found'));
    if ((socket.user.tv ?? 0) !== (u.tokenVersion || 0)) return next(new Error('token_revoked'));
    next();
  }
  catch { next(new Error('bad_token')); }
});

io.on('connection', (socket) => {
  socket.join('user:' + socket.user.id);
});

// ── Séances Premium ──────────────────────────────────────────────────────────

const SEANCES_DIR = path.join(__dirname, 'seances');

// Charge toutes les séances depuis le dossier au démarrage
function loadSeances() {
  const seances = [];
  if (!fs.existsSync(SEANCES_DIR)) return seances;
  const categories = fs.readdirSync(SEANCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  for (const cat of categories) {
    const catDir = path.join(SEANCES_DIR, cat);
    const files = fs.readdirSync(catDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(catDir, file), 'utf8'));
        seances.push(data);
      } catch (e) { console.warn('[seances] Erreur lecture', file, e.message); }
    }
  }
  return seances;
}
let SEANCES_CACHE = loadSeances();

// Liste des séances (premium only)
app.get('/api/seances', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(401).json({ error: 'not_found' });
  if (!u.premium && !u.fullAccess && !userHasAccess(u, 'coach')) return res.status(403).json({ error: 'premium_required' });
  const category = req.query.category;
  const list = category ? SEANCES_CACHE.filter(s => s.category === category) : SEANCES_CACHE;
  res.json(list);
});

// Séance aléatoire (premium only)
app.get('/api/seances/random', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(401).json({ error: 'not_found' });
  if (!u.premium && !u.fullAccess && !userHasAccess(u, 'coach')) return res.status(403).json({ error: 'premium_required' });
  const category = req.query.category;
  const pool = SEANCES_CACHE.filter(s => s.random !== false && (!category || s.category === category));
  if (!pool.length) return res.status(404).json({ error: 'no_seance' });
  res.json(pool[Math.floor(Math.random() * pool.length)]);
});

// Activer premium via code d'accès
app.post('/api/premium/unlock', authRequired, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code_required' });
  const rawCodes = (process.env.PREMIUM_CODES || '').split(',').map(c => c.trim()).filter(Boolean);
  const u = DATA.users[req.user.id];
  if (!u) return res.status(401).json({ error: 'not_found' });
  if (u.premium) return res.json({ ok: true, already: true });
  // Vérifier code valide et non déjà utilisé
  const used = DATA.premiumCodes || {};
  if (!rawCodes.includes(code)) return res.status(400).json({ error: 'invalid_code' });
  if (used[code]) return res.status(400).json({ error: 'code_already_used' });
  // Activer
  DATA.premiumCodes[code] = { usedBy: req.user.id, usedAt: Date.now() };
  u.premium = true;
  persist();
  res.json({ ok: true });
});

// Statut premium
app.get('/api/premium/status', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(401).json({ error: 'not_found' });
  res.json({ premium: !!u.premium });
});

// Coach principal : activer premium manuellement pour un utilisateur
app.post('/api/premium/grant/:userId', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  const u = DATA.users[req.params.userId];
  if (!u) return res.status(404).json({ error: 'not_found' });
  u.premium = !!req.body.enabled;
  persist();
  io.to('user:' + u.id).emit('premium-updated', { premium: u.premium });
  res.json({ ok: true, premium: u.premium });
});

// Coach principal : débloquer/révoquer l'accès complet à l'application (les 3 univers :
// Coaching, IA Programme, Explorer) pour un athlète, indépendamment de Stripe/de l'essai.
app.post('/api/access/grant/:userId', authRequired, coachOnly, mainCoachOnly, (req, res) => {
  const u = DATA.users[req.params.userId];
  if (!u) return res.status(404).json({ error: 'not_found' });
  u.fullAccess = !!req.body.enabled;
  persist();
  io.to('user:' + u.id).emit('full-access-updated', { fullAccess: u.fullAccess });
  res.json({ ok: true, fullAccess: u.fullAccess });
});

// ── Stripe routes ────────────────────────────────────

// Statut abonnement de l'utilisateur connecté
app.get('/api/stripe/status', authRequired, (req, res) => {
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  const inTrial = Date.now() < (u.createdAt || 0) + TRIAL_MS;
  const trialDaysLeft = inTrial ? Math.ceil(((u.createdAt || 0) + TRIAL_MS - Date.now()) / 86400000) : 0;
  const access = {
    explorer: userHasAccess(u, 'explorer'),
    ia:       userHasAccess(u, 'ia'),
    coach:    userHasAccess(u, 'coach'),
  };
  res.json({
    plan: u.stripePlan || null,
    status: u.stripeStatus || null,
    inTrial, trialDaysLeft,
    access,
    stripeEnabled: !!stripe,
  });
});

// Créer une session Checkout Stripe
app.post('/api/stripe/checkout', authRequired, async (req, res) => {
  if (!stripe) { console.error('[stripe] checkout: stripe not configured'); return res.status(503).json({ error: 'stripe_not_configured' }); }
  const { plan } = req.body || {};
  const priceMap = { explorer: STRIPE_PRICE_EXPLORER, ia: STRIPE_PRICE_IA, coaching: STRIPE_PRICE_COACHING };
  const priceId = priceMap[plan];
  console.log(`[stripe] checkout plan=${plan} priceId=${priceId} userId=${req.user.id}`);
  if (!priceId) return res.status(400).json({ error: 'invalid_plan', detail: `plan '${plan}' not found in price map` });
  const u = DATA.users[req.user.id];
  if (!u) return res.status(404).json({ error: 'not_found' });
  try {
    // Récupérer ou créer le customer Stripe
    let customerId = u.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: u.email, metadata: { userId: u.id } });
      customerId = customer.id;
      u.stripeCustomerId = customerId;
      persist();
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${PUBLIC_URL}/Muscu.html?stripe=success&plan=${plan}`,
      cancel_url: `${PUBLIC_URL}/Muscu.html?stripe=cancel`,
      allow_promotion_codes: true,
      subscription_data: { metadata: { userId: u.id, plan } },
    });
    res.json({ url: session.url });
  } catch(e) {
    console.error('[stripe] checkout error:', e.message);
    res.status(500).json({ error: 'checkout_failed', detail: e.message });
  }
});

// Portail client (gérer / annuler l'abonnement)
app.post('/api/stripe/portal', authRequired, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'stripe_not_configured' });
  const u = DATA.users[req.user.id];
  if (!u?.stripeCustomerId) return res.status(400).json({ error: 'no_subscription' });
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: u.stripeCustomerId,
      return_url: `${PUBLIC_URL}/Muscu.html`,
    });
    res.json({ url: session.url });
  } catch(e) {
    console.error('[stripe] portal error:', e.message);
    res.status(500).json({ error: 'portal_failed', detail: e.message });
  }
});

// Webhook Stripe — raw body obligatoire
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(200).json({ ok: true });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch(e) {
    console.error('[stripe] webhook signature error:', e.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  const applySubscription = (sub) => {
    const userId = sub.metadata?.userId;
    const plan   = sub.metadata?.plan || PRICE_TO_PLAN[sub.items?.data?.[0]?.price?.id];
    if (!userId || !DATA.users[userId]) return;
    const u = DATA.users[userId];
    u.stripePlan         = plan || u.stripePlan;
    u.stripeStatus       = sub.status; // active | past_due | canceled | ...
    u.stripeSubscriptionId = sub.id;
    persist();
    io.to('user:' + userId).emit('subscription-updated', { plan: u.stripePlan, status: u.stripeStatus });
    console.log(`[stripe] user ${u.email} → plan=${u.stripePlan} status=${u.stripeStatus}`);
  };

  switch(event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      applySubscription(event.data.object);
      break;
    case 'customer.subscription.deleted':
      applySubscription({ ...event.data.object, status: 'canceled' });
      break;
    default:
      break;
  }
  res.json({ received: true });
});

// Global error handlers — keep server alive on unexpected errors
process.on('uncaughtException', err => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection:', reason);
});

// Graceful shutdown : flush DB avant de mourir (évite la corruption de data.json)
function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} reçu — arrêt propre en cours`);
  server.close(() => {
    console.log('[shutdown] Serveur HTTP fermé');
    // Annuler les timers de sauvegarde différée et sauvegarder immédiatement
    if (saveTimer) clearTimeout(saveTimer);
    if (pgSaveTimer) clearTimeout(pgSaveTimer);
    try {
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(DATA));
      fs.renameSync(tmp, DB_PATH);
      console.log('[shutdown] DB vidée sur disque');
    } catch (e) { console.error('[shutdown] Erreur flush DB:', e.message); }
    process.exit(0);
  });
  // Forcer la sortie après 10s si des connexions restent ouvertes
  setTimeout(() => {
    console.error('[shutdown] Sortie forcée après timeout');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

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
