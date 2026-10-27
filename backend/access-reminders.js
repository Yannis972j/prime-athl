// Rappels d'expiration d'accès (athlète) : J-3, J-2, J-1.
// Le coach voit dans son interface « Rappels automatiques à l'athlète à J-3, J-2 et J-1 » : jusqu'ici ils
// n'existaient que sous forme de pop-up à l'OUVERTURE de l'app — un athlète qui ne l'ouvre pas ne
// recevait rien. Ce module décide, de façon pure et testable, qui doit recevoir une notification push.

// Jours restants (arrondi au supérieur, comme le pop-up du front). null = pas d'expiration / exempté.
//
// L'« accès complet » (fullAccess) ne dispense PAS de la durée : il déverrouille les univers, la durée fixée
// par le coach (accessExpiresAt) s'applique toujours — avant, un athlète en accès complet affichait
// « 6 jours restants » mais n'était ni prévenu ni bloqué à la date de fin.
export function accessDaysLeft(u, now = Date.now()) {
  if (!u || u.role === 'coach' || !u.accessExpiresAt) return null;
  const t = new Date(u.accessExpiresAt).getTime();
  if (isNaN(t)) return null;
  return Math.ceil((t - now) / 86400000);
}

// Liste des rappels à envoyer maintenant : un par athlète actif dont il reste 1 à 3 jours, une seule
// fois par palier et par date d'expiration (u.accessReminded[palier] === accessExpiresAt → déjà fait ;
// si le coach prolonge l'accès, la date change et les paliers repartent à zéro).
export function dueAccessReminders(users, now = Date.now()) {
  const due = [];
  for (const u of Object.values(users || {})) {
    if (!u || u.role !== 'athlete' || u.status !== 'active') continue;
    const d = accessDaysLeft(u, now);
    if (d == null || d < 1 || d > 3) continue;
    if (u.accessReminded && u.accessReminded[d] === u.accessExpiresAt) continue;
    due.push({ userId: u.id, palier: d, expiresAt: u.accessExpiresAt });
  }
  return due;
}

export function accessReminderPayload(palier, coachName) {
  const when = palier <= 1 ? 'dans moins de 24 h' : `dans ${palier} jours`;
  return {
    title: `⏳ Ton accès se termine ${when}`,
    body: `${coachName || 'Ton coach'} peut le prolonger : écris-lui avant la fin pour ne pas être bloqué.`,
    url: '/Muscu.html',
  };
}

// Fenêtre d'accès écoulée ? Jamais pour un coach / le coach principal, jamais sans date (= illimité).
export function isAccessExpiredFor(u, now = Date.now(), mainCoachEmail = '') {
  if (!u) return false;
  if (u.role === 'coach' || (mainCoachEmail && u.email === mainCoachEmail)) return false;
  if (!u.accessExpiresAt) return false;
  const t = new Date(u.accessExpiresAt).getTime();
  return !isNaN(t) && t <= now;
}

// Migration au démarrage : jusqu'ici l'accès complet exemptait de la durée, donc un athlète en accès
// complet dont la date était DÉJÀ dépassée n'a jamais été bloqué. Maintenant que la durée s'applique
// aussi à lui, on efface ces dates périmées (= accès illimité, ce qu'ils vivaient déjà) pour qu'aucun
// athlète ne soit bloqué d'un coup au déploiement. Les dates FUTURES gardent leur effet.
export function staleFullAccessExpiries(users, now = Date.now()) {
  const ids = [];
  for (const u of Object.values(users || {})) {
    if (!u || u.role === 'coach' || !u.fullAccess || !u.accessExpiresAt) continue;
    const t = new Date(u.accessExpiresAt).getTime();
    if (!isNaN(t) && t <= now) ids.push(u.id);
  }
  return ids;
}
