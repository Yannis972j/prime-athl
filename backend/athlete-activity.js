// Onglets de « Mes athlètes » : qui a fait une séance AUJOURD'HUI, et à qui le coach n'a pas encore répondu.
import { toValidDateMs } from './dates.js';

export function dayKeyTZ(ms, tz) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

// sessions : séances d'UN athlète. « À commenter » = séance faite par l'athlète (pas créée par le coach),
// sans feedback et non écartée par le coach (feedbackSkipped), dans les `windowDays` derniers jours (au-delà, on ne relance plus : ce serait du bruit).
export function feedbackStats(sessions, { now = Date.now(), tz = 'America/Martinique', windowDays = 14 } = {}) {
  const today = dayKeyTZ(now, tz);
  let todayCount = 0, todayLastAt = null, pendingCount = 0, latest = null;
  const from = now - windowDays * 86400000;
  for (const s of sessions || []) {
    const ms = s && toValidDateMs(s.date);
    if (ms === null || ms === undefined) continue;
    if (dayKeyTZ(ms, tz) === today) { todayCount++; if (todayLastAt === null || ms > todayLastAt) todayLastAt = ms; }
    const answered = typeof s.coachFeedback === 'string' && s.coachFeedback.trim() !== '';
    // feedbackSkipped : le coach a choisi de NE PAS commenter cette séance → elle ne compte plus.
    if (!s.createdByCoach && !answered && !s.feedbackSkipped && ms >= from && ms <= now + 26 * 3600000) {
      pendingCount++;
      if (!latest || ms > latest.ms) latest = { id: s.id, name: s.name || 'Séance', date: new Date(ms).toISOString(), ms };
    }
  }
  return {
    todaySessionCount: todayCount,
    todayLastAt: todayLastAt === null ? null : new Date(todayLastAt).toISOString(),
    pendingFeedbackCount: pendingCount,
    latestPendingSession: latest ? { id: latest.id, name: latest.name, date: latest.date } : null,
  };
}

// Séances qu'un coach peut encore commenter (mêmes règles que ci-dessus) : sert à « Ne pas commenter » en bloc.
export function pendingFeedbackSessions(sessions, { now = Date.now(), windowDays = 14 } = {}) {
  const from = now - windowDays * 86400000;
  return (sessions || []).filter(s => {
    const ms = s && toValidDateMs(s.date);
    if (ms === null || ms === undefined) return false;
    const answered = typeof s.coachFeedback === 'string' && s.coachFeedback.trim() !== '';
    return !s.createdByCoach && !answered && !s.feedbackSkipped && ms >= from && ms <= now + 26 * 3600000;
  });
}
