// Validation / normalisation des dates (séances, poids, photos).
// Une date invalide ne doit JAMAIS être stockée : le front plante sur .toISOString().
const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);
const FUTURE_TOLERANCE_MS = 26 * 3600 * 1000; // fuseaux horaires + horloge du téléphone

// Retourne un timestamp ms valide, ou null.
export function toValidDateMs(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  let ms;
  if (typeof v === 'number') ms = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    ms = /^\d{10,13}$/.test(s) ? Number(s) : Date.parse(s);
  } else if (v instanceof Date) ms = v.getTime();
  else return null;
  if (!Number.isFinite(ms)) return null;
  if (ms < MIN_MS || ms >= MAX_MS) return null;
  return ms;
}

// Date de séance : ISO valide, jamais dans le futur (au-delà de la tolérance).
// Sinon on garde la séance mais on la date de maintenant.
export function sessionDateISO(v, now = Date.now()) {
  const ms = toValidDateMs(v);
  if (ms === null || ms > now + FUTURE_TOLERANCE_MS) return new Date(now).toISOString();
  return new Date(ms).toISOString();
}

// Validation stricte (routes coach) : { ok, iso } ou { ok:false, error }
export function strictSessionDate(v, now = Date.now()) {
  if (v === undefined || v === null || v === '') return { ok: true, iso: new Date(now).toISOString() };
  const ms = toValidDateMs(v);
  if (ms === null) return { ok: false, error: 'invalid_date' };
  if (ms > now + FUTURE_TOLERANCE_MS) return { ok: false, error: 'date_in_future' };
  return { ok: true, iso: new Date(ms).toISOString() };
}

// Date de pesée / photo : ms valides, sinon repli (createdAt ou now).
export function entryDateMs(v, fallback = Date.now()) {
  const ms = toValidDateMs(v);
  if (ms === null || ms > Date.now() + FUTURE_TOLERANCE_MS) return fallback;
  return ms;
}

export function validWeightKg(w) {
  const n = typeof w === 'string' ? parseFloat(w.replace(',', '.')) : w;
  return Number.isFinite(n) && n >= 20 && n <= 500 ? Math.round(n * 100) / 100 : null;
}

// Réparation des données déjà stockées. Retourne le nombre d'entrées corrigées.
export function repairStoredDates(DATA, now = Date.now()) {
  let n = 0;
  for (const s of Object.values(DATA.sessions || {})) {
    if (!s) continue;
    const ms = toValidDateMs(s.date);
    if (ms === null) {
      const alt = toValidDateMs(s.createdAt) ?? toValidDateMs(s.updatedAt) ?? now;
      s.date = new Date(alt).toISOString(); n++;
    } else if (typeof s.date !== 'string') { s.date = new Date(ms).toISOString(); n++; }
  }
  for (const key of ['weightLogs', 'progressPhotos']) {
    for (const list of Object.values(DATA[key] || {})) {
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        if (!e) continue;
        if (toValidDateMs(e.date) === null) { e.date = toValidDateMs(e.createdAt) ?? now; n++; }
      }
    }
  }
  return n;
}
