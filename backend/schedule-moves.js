// Déplacements de séances du programme (scheduleMoves[toDate] = { sourceDayName, sourceDate, … }).
// Déplacer sur un jour occupé ÉCHANGE les deux séances au lieu d'écraser celle du jour cible.
// Fonctions pures (mutent seulement l'objet `moves` passé) pour être testables sans serveur.

// Une entrée qui remet la séance sur sa date d'origine ne sert à rien : on la retire.
function dropNaturalEntries(moves) {
  for (const k of Object.keys(moves)) if (moves[k] && moves[k].sourceDate === k) delete moves[k];
}

// dayNames : Set des jours (« LUNDI »…) portant une séance dans le programme ; dayOf(ymd) → nom du jour.
export function applyMove(moves, { fromDate, toDate, force, dayNames, dayOf, now = Date.now(), movedBy }) {
  let src;
  if (moves[fromDate]) src = { sourceDayName: moves[fromDate].sourceDayName, sourceDate: moves[fromDate].sourceDate };
  else {
    const dn = dayOf(fromDate);
    if (!dayNames.has(dn)) return { error: 'no_session_on_date' };
    src = { sourceDayName: dn, sourceDate: fromDate };
  }
  // Occupant du jour cible : une séance déplacée là, ou la séance naturelle du jour (si elle n'a pas bougé).
  const movedAway = new Set(Object.values(moves).map(m => m.sourceDate));
  let occupant = null;
  if (moves[toDate]) occupant = { sourceDayName: moves[toDate].sourceDayName, sourceDate: moves[toDate].sourceDate };
  else if (dayNames.has(dayOf(toDate)) && !movedAway.has(toDate)) occupant = { sourceDayName: dayOf(toDate), sourceDate: toDate };
  if (occupant && !force) return { error: 'target_occupied' };

  const meta = { movedAt: now, ...(movedBy ? { movedBy } : {}) };
  delete moves[fromDate];
  moves[toDate] = { ...src, ...meta };
  if (occupant) moves[fromDate] = { ...occupant, ...meta }; // échange : l'occupant prend la place libérée
  dropNaturalEntries(moves);
  return { ok: true, swapped: !!occupant };
}

// Annule le déplacement arrivé sur `date` : la séance retourne à sa date d'origine. Si cette date
// est occupée par une autre séance déplacée, celle-ci prend la place libérée (aucune perte).
export function cancelMove(moves, date) {
  const m = moves[date];
  if (!m) return { error: 'not_found' };
  const back = m.sourceDate;
  delete moves[date];
  if (moves[back]) {
    const other = moves[back];
    delete moves[back];
    moves[date] = { sourceDayName: other.sourceDayName, sourceDate: other.sourceDate, movedAt: other.movedAt, ...(other.movedBy ? { movedBy: other.movedBy } : {}) };
  }
  dropNaturalEntries(moves);
  return { ok: true };
}
