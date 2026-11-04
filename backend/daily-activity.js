// Notification quotidienne du SOIR : prépare mentalement l'athlète à la séance de DEMAIN, tout en le félicitant
// (ou le relançant, sans jamais culpabiliser) selon son activité. Module pur, testable sans serveur.
//
// Envoyée entre 20 h et 23 h (heure de Martinique, rattrapable), au moment où l'on se prépare à dormir : on y
// annonce la séance de demain, on y glisse une consigne de préparation mentale (sommeil, visualisation, sac prêt…)
// et on reconnaît ce que l'athlète a fait aujourd'hui. Le message de 5 h, lui, reste générique.
import { zonedParts, shouldSendMotivation, MOTIVATION_TZ } from './motivation.js';

export const ACTIVITY_NOTIF_HOUR = 20;
export const ACTIVITY_NOTIF_WINDOW_HOURS = 3;

const DAY = 86400000;
const DAY_FR = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const DAY_LABEL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// L'envoi est-il dû ? Même mécanique que la motivation de 5 h : une fois par jour, rattrapable dans la fenêtre.
export function shouldSendActivityNotif(now, lastRunDate, tz = MOTIVATION_TZ) {
  const parts = zonedParts(new Date(now), tz);
  return { due: shouldSendMotivation(parts, lastRunDate, ACTIVITY_NOTIF_HOUR, ACTIVITY_NOTIF_WINDOW_HOURS), dateStr: parts.dateStr };
}

// Résumé de l'activité d'un athlète à partir de ses séances (« aujourd'hui » = jour calendaire du fuseau).
export function activitySummary(sessions, now = Date.now(), tz = MOTIVATION_TZ) {
  const today = zonedParts(new Date(now), tz).dateStr;
  const list = (sessions || [])
    .filter(s => s && s.date && !isNaN(new Date(s.date).getTime()) && new Date(s.date).getTime() <= now)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const dayOf = s => zonedParts(new Date(s.date), tz).dateStr;
  const todaySessions = list.filter(s => dayOf(s) === today);
  const weekCount = list.filter(s => now - new Date(s.date).getTime() < 7 * DAY).length;
  const diff = (a, b) => Math.max(0, Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY));
  let daysSince = null;
  if (list.length) daysSince = diff(today, dayOf(list[0]));
  const prev = list.find(s => dayOf(s) < today); // séance la plus récente AVANT aujourd'hui
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - DAY).toISOString().slice(0, 10);
  return {
    today, total: list.length, weekCount, daysSince, todaySessions,
    todayVolume: todaySessions.reduce((v, s) => v + (+s.totalVolume || 0), 0),
    daysSincePrev: prev ? diff(today, dayOf(prev)) : null,
    trainedYesterday: list.some(s => dayOf(s) === yesterday),
    lastTodayAt: todaySessions.length ? new Date(todaySessions[0].date).getTime() : null,
  };
}

const addDays = (dateStr, n) => new Date(Date.parse(dateStr + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekdayOf = dateStr => new Date(dateStr + 'T12:00:00Z').getUTCDay();

// Séance prévue à une date donnée pour un athlète : programme (avec les séances déplacées par le coach) et séances
// planifiées. data = { programs, scheduleMoves, plannedSessions } (mêmes structures que DATA côté serveur).
// → { has, label, exCount } ; label = nom de séance si non ambigu (sinon null).
export function sessionOnDate(data, userId, dateStr) {
  const moves = (data.scheduleMoves && data.scheduleMoves[userId]) || {};
  let dayName = null;
  if (moves[dateStr]) dayName = moves[dateStr].sourceDayName;
  else if (!Object.values(moves).some(m => m && m.sourceDate === dateStr)) dayName = DAY_FR[weekdayOf(dateStr)];
  const labels = new Set(); let exCount = 0, has = false;
  const prog = data.programs && data.programs[userId];
  if (dayName && prog && prog.data) {
    for (const sheet of Object.values(prog.data)) {
      const d = sheet && sheet[dayName];
      if (d && Array.isArray(d.exercises) && d.exercises.length) { has = true; exCount = exCount || d.exercises.length; if (d.category) labels.add(String(d.category).trim()); }
    }
  }
  const planned = (data.plannedSessions && data.plannedSessions[userId] && data.plannedSessions[userId][dateStr]) || [];
  for (const p of planned) { if (p && p.name) { has = true; labels.add(String(p.name).trim()); exCount = exCount || (Array.isArray(p.exercises) ? p.exercises.length : 0); } }
  return { has, label: labels.size === 1 ? [...labels][0] : null, exCount };
}

// Plan de demain : séance annoncée, jour de repos (avec la prochaine séance), ou inconnu (athlète sans programme
// ni séance planifiée — typiquement la Bibliothèque : on ne sait pas ce qu'il fera demain).
export function tomorrowPlan(data, userId, todayStr) {
  const prog = data.programs && data.programs[userId];
  const hasProgram = !!(prog && prog.data && Object.keys(prog.data).length);
  const hasPlanned = !!(data.plannedSessions && data.plannedSessions[userId] && Object.keys(data.plannedSessions[userId]).length);
  if (!hasProgram && !hasPlanned) return { kind: 'unknown' };
  const t = sessionOnDate(data, userId, addDays(todayStr, 1));
  if (t.has) return { kind: 'session', label: t.label, exCount: t.exCount };
  for (let i = 2; i <= 7; i++) {
    const ds = addDays(todayStr, i);
    const n = sessionOnDate(data, userId, ds);
    if (n.has) return { kind: 'rest', nextDay: DAY_LABEL[weekdayOf(ds)], nextLabel: n.label };
  }
  return { kind: 'rest' };
}

const hash = str => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); };
const gg = (gender, masc, fem) => (gender === 'f' ? fem : masc);
const fmtKg = v => Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Choisit le message du soir. Toujours bienveillant : aucune phrase culpabilisante, même après une longue pause.
// plan = tomorrowPlan(...) ; sans plan → { kind: 'unknown' }.
export function pickDailyMessage(sum, user, now = Date.now(), plan = { kind: 'unknown' }) {
  const u = user || {};
  const nm = String(u.cpNickname || u.firstName || '').trim();
  const g = u.gender;
  const target = u.goalWeeklyTarget > 0 ? u.goalWeeklyTarget : 0;
  const threshold = target ? Math.max(2, target) : 3;
  const last = sum.todaySessions[0]; // la plus récente du jour (liste triée)
  const comma = nm ? `, ${nm}` : '';
  const days = sum.daysSince;

  // 1) Activité → « kind » + courte phrase d'ouverture (félicitation ou motivation)
  let kind, opener;
  if (sum.todaySessions.length) {
    const beforeToday = sum.weekCount - sum.todaySessions.length;
    if (last.lightReason === 'menstrual') { kind = 'cycle'; opener = 'Merci d\'avoir écouté ton corps aujourd\'hui.'; }
    else if (last.deload) { kind = 'deload'; opener = 'Décharge validée : la récup fait partie du jeu.'; }
    else if (target > 0 && sum.weekCount >= target && beforeToday < target) { kind = 'week_goal'; opener = `Objectif de la semaine atteint 🏆 (${sum.weekCount}/${target}).`; }
    else { kind = 'done_today'; opener = `Séance du jour validée${sum.todayVolume > 0 ? ` — ${fmtKg(sum.todayVolume)} kg soulevés` : ''} 💪.`; }
  } else if (sum.total === 0) { kind = 'new'; opener = 'Demain, c\'est le grand départ.'; }
  else if (sum.weekCount >= threshold) { kind = 'streak'; opener = `${sum.weekCount} séances cette semaine, belle régularité${comma}.`; }
  else if (days === 1) { kind = 'yesterday'; opener = 'Belle dynamique depuis hier.'; }
  else if (days <= 3) { kind = 'short_break'; opener = `${days} jours depuis ta dernière séance : on relance la machine.`; }
  else { kind = 'long_break'; opener = 'Pas de reproche : on reprend simplement.'; }

  // 2) Consigne de préparation mentale pour demain (une par soir, tournante)
  const prep = [
    'Couche-toi tôt : c\'est la nuit que tu te prépares.',
    'Visualise ta 1re série, mouvement par mouvement.',
    'Prépare ton sac et ta gourde dès ce soir.',
    'Dîne correctement : l\'énergie de demain se joue maintenant.',
    'Fixe-toi un objectif simple : une rep ou un kilo de plus.',
    'Pas d\'écran trop tard : esprit reposé, séance affûtée.',
    'Respire, hydrate-toi, et vois-toi déjà en salle.',
    `Ce soir tu te prépares ; demain tu seras ${gg(g, 'prêt', 'prête')}.`,
  ];
  const restTips = [
    'Hydrate-toi, bouge doucement, dors bien : la récup, c\'est du progrès.',
    'Étirements, marche, bon repas : le corps construit pendant le repos.',
  ];
  const seed = hash(String(u.id || nm) + '|' + sum.today);
  const prepTip = prep[seed % prep.length];

  let title, body;
  if (plan.kind === 'session') {
    title = `🌙 Demain : ${plan.label ? cut(plan.label, 30) : 'ta séance'}`;
    body = `${opener} ${prepTip}`;
  } else if (plan.kind === 'rest') {
    title = '🌙 Demain : récupération';
    const next = plan.nextDay ? ` Prochaine séance : ${plan.nextDay}${plan.nextLabel ? ' — ' + cut(plan.nextLabel, 24) : ''}.` : '';
    body = `${opener} ${restTips[seed % restTips.length]}${next}`;
  } else {
    title = '🌙 Prépare ta prochaine séance';
    body = `${opener} ${prepTip}`;
  }
  // tag fixe : le message d'hier encore non lu est remplacé par celui d'aujourd'hui au lieu de s'empiler.
  return { kind, plan: plan.kind, title: cut(title, 48), body: cut(body, 170), url: '/Muscu.html', tag: 'daily-activity' };
}

// ── Message APRÈS la séance : envoyé quand l'athlète a terminé sa séance du jour ─────────────────────────────────
// Les 5 messages de Yannis, mot pour mot. Choisis selon l'activité et la régularité de l'athlète.
export const POST_SESSION_MESSAGES = [
  'Demain, une nouvelle bataille t\'attend. Prépare ton mental, ton corps suivra.',
  'Tu as assuré aujourd\'hui. Demain, on remet ça. La régularité forge les champions.',
  'Le repos de ce soir prépare la performance de demain. Reste déterminé.',
  'Demain, ne cherche pas d\'excuses. Souviens-toi pourquoi tu as commencé.',
  'Une journée de plus, un pas de plus vers ton objectif. Demain, on avance !',
];

// Heure d'envoi selon l'heure de FIN de séance (heure locale) :
//   avant 12 h → 18 h · 12 h–18 h → 20 h · 18 h–20 h → 20 h (ou 1 h après si plus tard) · 20 h–23 h → 1 h après
//   · à partir de 23 h → pas d'envoi (l'athlète va dormir).
export function postSessionSendAt(finishedAtMs, tz = MOTIVATION_TZ) {
  const p = zonedParts(new Date(finishedAtMs), tz);
  const finishMin = p.hour * 60 + p.minute;
  let targetMin;
  if (p.hour < 12) targetMin = 18 * 60;
  else if (p.hour < 18) targetMin = 20 * 60;
  else if (p.hour < 20) targetMin = Math.max(20 * 60, finishMin + 60);
  else if (p.hour < 23) targetMin = finishMin + 60;
  else return null;
  const secMs = new Date(finishedAtMs).getUTCSeconds() * 1000 + new Date(finishedAtMs).getUTCMilliseconds();
  return finishedAtMs - secMs + (targetMin - finishMin) * 60000;
}

// Un envoi manqué (serveur arrêté) n'est rattrapé que dans cette fenêtre : au-delà, le message serait hors de propos.
export const POST_SESSION_CATCHUP_MS = 3 * 3600000;

// Qui reçoit les notifications du soir : les athlètes actifs ET le coach principal, qui s'entraîne aussi
// (il a son propre profil coaching et ses propres séances). Un autre coach n'en reçoit pas.
export function eligibleForActivityNotifs(u) {
  if (!u || u.status !== 'active') return false;
  return u.role === 'athlete' || (u.role === 'coach' && !!u.isMainCoach);
}
// Le message de 20 h (pour ceux qui ne se sont pas entraînés aujourd'hui) : jamais au coach qui n'a encore
// enregistré aucune séance — il n'est pas un « débutant à relancer », il n'utilise simplement pas l'app pour s'entraîner.
export function wantsEveningNudge(u, totalSessions) {
  return u && u.role === 'coach' ? totalSessions > 0 : true;
}

// Rythme attendu : objectif hebdo du profil, sinon nombre de jours d'entraînement du programme, sinon 3.
export function weeklyCadence(user, data) {
  const t = user && user.goalWeeklyTarget > 0 ? user.goalWeeklyTarget : 0;
  if (t) return t;
  const prog = data && data.programs && data.programs[user && user.id];
  let best = 0;
  if (prog && prog.data) for (const sheet of Object.values(prog.data)) best = Math.max(best, Object.values(sheet || {}).filter(d => d && Array.isArray(d.exercises) && d.exercises.length).length);
  return best >= 1 ? best : 3;
}

// Limites de ton déclarées par l'athlète (fiche « Mon Profil Coaching », même lecture que l'application).
export function toneLimits(user) {
  const dont = Array.isArray(user && user.cpDontDo) ? user.cpDontDo : [];
  return { noGuilt: dont.includes('Culpabilisant'), soft: dont.includes('Trop agressif') || dont.includes('Trop de messages'), tooMany: dont.includes('Trop de messages') };
}

// Choisit parmi les 5 messages selon l'activité et la périodicité :
//   séance tardive (≥ 20 h) → « le repos de ce soir » · demain séance + en retard sur son rythme → « pas d'excuses »
//   (jamais pour qui a demandé un ton doux) · demain séance + régulier → « la régularité forge » · sinon → « une
//   nouvelle bataille » ; demain repos / inconnu → « un pas de plus ».
export function pickPostSessionMessage(sum, user, plan = { kind: 'unknown' }, opts = {}) {
  const u = user || {};
  const cadence = opts.cadence || 3;
  const limits = toneLimits(u);
  const finishHour = sum.lastTodayAt ? zonedParts(new Date(sum.lastTodayAt), opts.tz || MOTIVATION_TZ).hour : 12;
  const onTrack = sum.weekCount >= cadence;
  // « En retard » = vrai décrochage de périodicité : l'écart depuis la séance précédente dépasse nettement l'espacement
  // attendu (7 / rythme hebdo, +2 jours), et au moins 4 jours. Le nombre de séances sur 7 jours glissants n'est PAS
  // utilisé : en milieu de semaine il sous-estime toujours le rythme et accuserait à tort un athlète régulier.
  const gapLimit = Math.max(4, Math.ceil(7 / cadence) + 2);
  const behind = sum.daysSincePrev !== null && sum.daysSincePrev >= gapLimit;
  let idx;
  if (finishHour >= 20) idx = 2;
  else if (plan.kind === 'session') {
    // Il a enchaîné hier + aujourd'hui, ou tient son rythme → on salue la régularité (jamais de reproche) ;
    // sinon, en retard sur son rythme → rappel du « pourquoi » (sauf ton doux demandé) ; sinon message d'entrain.
    if (sum.trainedYesterday || onTrack) idx = 1;
    else if (behind && !limits.soft && !limits.noGuilt) idx = 3;
    else idx = 0;
  } else idx = 4;
  const nm = String(u.cpNickname || u.firstName || '').trim();
  let title;
  if (plan.kind === 'session') title = `🌙 Demain : ${plan.label ? cut(plan.label, 30) : 'ta séance'}`;
  else if (plan.kind === 'rest') title = '🌙 Demain : récupération';
  else title = `💪 Séance validée${nm ? ', ' + nm : ''}`;
  return { kind: 'post_session', idx, plan: plan.kind, title: cut(title, 48), body: POST_SESSION_MESSAGES[idx], url: '/Muscu.html', tag: 'daily-activity' };
}
