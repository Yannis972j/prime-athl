// Rappels d'expiration d'accès (athlète) : J-3, J-2, J-1.
// Le coach voit dans son interface « Rappels automatiques à l'athlète à J-3, J-2 et J-1 » : jusqu'ici ils
// n'existaient que sous forme de pop-up à l'OUVERTURE de l'app — un athlète qui ne l'ouvre pas ne
// recevait rien. Ce module décide, de façon pure et testable, qui doit recevoir une notification push.

// Jours restants (arrondi au supérieur, comme le pop-up du front). null = pas d'expiration / exempté.
export function accessDaysLeft(u, now = Date.now()) {
  if (!u || u.role === 'coach' || u.fullAccess || !u.accessExpiresAt) return null;
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
