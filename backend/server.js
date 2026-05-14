// Prime Athl backend — Express + JSON file storage + Socket.IO
// Pure-JS, zero native deps. Run: npm install && npm start
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT             = process.env.PORT       || 3001;
const JWT_SECRET       = process.env.JWT_SECRET || 'dev-secret-' + Math.random().toString(36).slice(2);
const DB_PATH          = process.env.DB_PATH    || path.join(__dirname, 'data.json');
// Try multiple frontend paths (local dev, Render deploy)
const FRONTEND_CANDIDATES = [
  path.join(__dirname, 'public'),         // bundled inside backend (prod)
  path.join(__dirname, '..', 'muscu'),    // local dev (sibling folder)
];
const FRONTEND         = FRONTEND_CANDIDATES.find(p => fs.existsSync(p)) || FRONTEND_CANDIDATES[0];
const MAIN_COACH_EMAIL = (process.env.MAIN_COACH_EMAIL || 'yannisgym972@gmail.com').toLowerCase();

// ── JSON file DB + optional Gist cloud backup ───────
const DEFAULT_DB = { users: {}, programs: {}, sessions: {}, invites: {}, nutritionPrograms: {}, nutritionLogs: {} };
const GIST_ID      = process.env.GIST_ID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const USE_GIST     = !!(GIST_ID && GITHUB_TOKEN);

async function gistFetch() {
  if (!USE_GIST) return null;
  try {
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'prime-athl', 'Accept': 'application/vnd.github+json' }
    });
    if (!r.ok) { console.error('Gist fetch HTTP', r.status); return null; }
    const gist = await r.json();
    const file = Object.values(gist.files || {})[0];
    if (!file || !file.content) return null;
    try {
      const parsed = JSON.parse(file.content);
      console.log('Loaded data from Gist:', Object.keys(parsed.users || {}).length, 'users');
      return parsed;
    } catch (e) { console.error('Gist JSON parse error:', e.message); return null; }
  } catch (e) { console.error('Gist fetch error:', e.message); return null; }
}

async function gistSave() {
  if (!USE_GIST) return;
  try {
    const r1 = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'prime-athl' }
    });
    if (!r1.ok) { console.error('Gist save: get failed', r1.status); return; }
    const gist = await r1.json();
    const filename = Object.keys(gist.files || {})[0] || 'data.json';
    const r2 = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'prime-athl' },
      body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(DATA, null, 2) } } })
    });
    if (!r2.ok) console.error('Gist save HTTP', r2.status);
  } catch (e) { console.error('Gist save error:', e.message); }
}

// Boot: try local file first, fallback to Gist if local is empty
let DATA = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    for (const k of Object.keys(DEFAULT_DB)) if (!raw[k]) raw[k] = structuredClone(DEFAULT_DB[k]);
    return raw;
  } catch { return structuredClone(DEFAULT_DB); }
})();

if (USE_GIST && Object.keys(DATA.users).length === 0) {
  // Local is empty → try to restore from Gist
  console.log('Local empty, restoring from Gist...');
  const restored = await gistFetch();
  if (restored && Object.keys(restored.users || {}).length > 0) {
    DATA = restored;
    for (const k of Object.keys(DEFAULT_DB)) if (!DATA[k]) DATA[k] = structuredClone(DEFAULT_DB[k]);
    try { fs.writeFileSync(DB_PATH, JSON.stringify(DATA, null, 2)); } catch {}
    console.log('Restored from Gist:', Object.keys(DATA.users).length, 'users');
  } else {
    console.log('Gist empty or unreachable, starting fresh');
  }
}

let saveTimer = null;
let gistSaveTimer = null;
let saving = false;
function persist() {
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
  // Backup to Gist (debounced to 8s to limit API calls)
  if (USE_GIST) {
    if (gistSaveTimer) clearTimeout(gistSaveTimer);
    gistSaveTimer = setTimeout(() => { gistSave(); }, 8000);
  }
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
};

const isMainCoach = u => u && (u.isMainCoach || u.email === MAIN_COACH_EMAIL);

const findUserByEmail = email => Object.values(DATA.users).find(u => u.email === email.toLowerCase());

// ── Middleware ──────────────────────────────────────
const authRequired = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'no_token' });
  try {
    req.user = verify(h.slice(7));
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
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Redirect root to Muscu.html so https://prime-athl.onrender.com loads the app
app.get('/', (req, res) => res.redirect('/Muscu.html'));

app.use(express.static(FRONTEND));

// ── Auth ────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, role, inviteCode: ic } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    if (password.length < 6)  return res.status(400).json({ error: 'password_too_short' });

    const lowEmail = email.toLowerCase();
    if (findUserByEmail(lowEmail)) return res.status(400).json({ error: 'email_already_used' });

    let userRole = role === 'coach' ? 'coach' : 'athlete';
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
    const passwordHash = await bcrypt.hash(password, 10);
    const u = {
      id, email: lowEmail, passwordHash, role: userRole, coachId,
      firstName: '', lastName: '', height: '', weight: '', objective: '',
      prSquat: '', prBench: '', prDeadlift: '',
      createdAt: Date.now(),
      status, isMainCoach: isMain,
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
    res.json({ token: sign({ id: u.id, role: u.role }), user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'signup_failed' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = findUserByEmail((email || '').toLowerCase());
    if (!u) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    if (u.status === 'pending') return res.status(403).json({ error: 'pending_approval' });
    res.json({ token: sign({ id: u.id, role: u.role }), user: profileOf(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'login_failed' }); }
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

app.put('/api/coach/program/:athleteId', authRequired, coachOnly, (req, res) => {
  const a = DATA.users[req.params.athleteId];
  if (!a || a.coachId !== req.user.id) return res.status(404).json({ error: 'athlete_not_found' });
  const data = req.body?.data || {};
  const ts = Date.now();
  DATA.programs[req.params.athleteId] = { data, assignedBy: req.user.id, assignedAt: ts };
  persist();
  io.to('user:' + req.params.athleteId).emit('program-updated', { data, assignedAt: ts });
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
    persistent: DB_PATH.startsWith('/data') || USE_GIST,
    storage: USE_GIST ? 'gist' : (DB_PATH.startsWith('/data') ? 'render-disk' : 'ephemeral'),
    timestamp: Date.now(),
  });
});

// Manual backup trigger (main coach only)
app.post('/api/admin/gist-sync', authRequired, coachOnly, mainCoachOnly, async (req, res) => {
  if (!USE_GIST) return res.status(400).json({ error: 'gist_not_configured' });
  await gistSave();
  res.json({ ok: true });
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
  u.status = 'active';
  persist();
  // Tell anyone listening (the now-active user can be notified to retry login)
  io.to('user:' + u.id).emit('account-approved', { profile: profileOf(u) });
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
  res.json({ ok: true, assignedAt: ts });
});

// Coach fetches athlete's nutrition (plan + history)
app.get('/api/coach/athletes/:id/nutrition', authRequired, coachOnly, (req, res) => {
  const u = DATA.users[req.params.id];
  if (!u || u.coachId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const plan = DATA.nutritionPrograms[u.id] || null;
  const logs = DATA.nutritionLogs[u.id] || {};
  const history = {};
  for (let i = 0; i < 14; i++) {
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
