// Planification de la notification quotidienne de motivation (fonction pure, testable sans serveur).
//
// Avant : le serveur vérifiait « heure == 5 ET minute == 0 » toutes les 60 s. Un setInterval dérive de
// quelques ms par tick : au bout de quelques jours, deux ticks encadrent la minute 05:00 sans jamais la
// toucher (04:59:59.9 puis 05:01:00.0) → la notification du jour était perdue, silencieusement. Et le
// dernier envoi n'était gardé qu'en mémoire (un redéploiement le faisait oublier).
// Maintenant : on envoie dès l'heure cible et jusqu'à `windowHours` plus tard (rattrapage), une seule
// fois par jour, en s'appuyant sur la date du dernier envoi (persistée par le serveur).
export const MOTIVATION_TZ = 'America/Martinique';
export const MOTIVATION_HOUR = 5;
export const MOTIVATION_WINDOW_HOURS = 5; // rattrape un tick manqué / un redémarrage jusqu'à 10 h

// Date « YYYY-MM-DD » et heure (0-23) dans le fuseau demandé.
export function zonedParts(date, tz = MOTIVATION_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t)?.value;
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10) % 24, // certains moteurs renvoient « 24 » pour minuit
    minute: parseInt(get('minute'), 10),
  };
}

export function shouldSendMotivation(parts, lastSentDate, hour = MOTIVATION_HOUR, windowHours = MOTIVATION_WINDOW_HOURS) {
  return lastSentDate !== parts.dateStr && parts.hour >= hour && parts.hour < hour + windowHours;
}
