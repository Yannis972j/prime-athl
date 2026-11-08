// Accès par UNIVERS donné par le coach (cases à cocher) : coach, ia, explorer, programmes (Catalogue).
// Une valeur explicite (true/false) l'emporte sur le reste (accès complet, abonnement) ; sans valeur
// explicite, les règles habituelles s'appliquent (le Catalogue est ouvert à tous par défaut).
export const UNIVERSES = ['coach', 'ia', 'explorer', 'programmes'];

export function cleanUniverseAccess(obj) {
  const out = {};
  if (obj && typeof obj === 'object') for (const k of UNIVERSES) if (typeof obj[k] === 'boolean') out[k] = obj[k];
  return out;
}
// true/false si le coach a tranché pour cet univers, sinon undefined.
export function universeOverride(u, universe) {
  const v = u && u.universeAccess && Object.prototype.hasOwnProperty.call(u.universeAccess, universe) ? u.universeAccess[universe] : undefined;
  return typeof v === 'boolean' ? v : undefined;
}
// Applique {universe, enabled} ou {all}. Retourne le nouvel objet ou null si requête invalide.
export function applyUniverseChange(current, body) {
  const next = cleanUniverseAccess(current);
  if (body && typeof body.all === 'boolean') { for (const k of UNIVERSES) next[k] = body.all; return next; }
  if (!body || !UNIVERSES.includes(body.universe) || typeof body.enabled !== 'boolean') return null;
  next[body.universe] = body.enabled;
  return next;
}
