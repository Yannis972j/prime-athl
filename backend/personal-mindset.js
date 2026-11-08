// Citations de mindset PERSONNALISÉES d'un athlète (ex. Inaya, nageuse) : si l'athlète en a, elles remplacent les
// phrases de Mindset génériques de SON récap — et uniquement le sien. Champ `mindsetPhrases` (tableau de textes) posé
// par le coach ; l'athlète ne peut pas le modifier. Module pur, testable sans serveur.

// Les 10 citations « natation » d'Inaya (texte du coach, sans guillemets ni numéros).
export const SWIM_PHRASES = [
  "Chaque goutte de sueur à la salle est une vague de progrès dans ta transformation.",
  "Le nageur ne combat pas l'eau, il apprend à la maîtriser. L'athlète ne combat pas la difficulté, il apprend à la dépasser.",
  "Sous la surface, personne ne voit tes efforts. Mais chaque mouvement te rapproche de ton objectif.",
  "Ne cherche pas à aller plus vite que les autres. Cherche à nager plus loin que ton ancien toi.",
  "La progression, c'est comme la nage : ce sont les mouvements répétés qui te font avancer, pas les éclaboussures.",
  "Quand tes muscles brûlent et que ton mental vacille, rappelle-toi pourquoi tu as plongé.",
  "Les vagues ne rendent pas le nageur plus faible. Elles forgent sa capacité à avancer.",
  "Chaque répétition est une longueur de plus vers la version de toi que tu veux devenir.",
  "Tu ne construis pas un physique dans les eaux calmes, mais dans les profondeurs de la discipline.",
  "Plonge avec ambition. Entraîne-toi avec discipline. Ressors plus fort.",
];

export const MAX_PERSONAL_PHRASES = 30;
export const MAX_PHRASE_LENGTH = 240;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Nettoie une liste envoyée par le coach : textes non vides, rognés, sans doublon, bornés. null si ce n'est pas un tableau.
export function sanitizePhrases(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const x of v) {
    const t = String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE_LENGTH);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_PERSONAL_PHRASES) break;
  }
  return out;
}

// Pose les citations de natation sur le compte d'Inaya, au démarrage, UNE SEULE FOIS : seulement s'il existe exactement
// un athlète prénommé « Inaya » et qu'aucune liste n'a encore été définie (le coach peut ensuite la modifier ou la vider
// sans qu'on la remette). Plusieurs « Inaya » → on ne touche à personne (le coach assigne à la main).
export function seedSwimPhrases(users) {
  const cands = Object.values(users || {}).filter(u => u && u.role === 'athlete' && norm(u.firstName) === 'inaya');
  if (cands.length !== 1) return { changed: false, count: cands.length };
  const u = cands[0];
  if (u.mindsetPhrases !== undefined) return { changed: false, count: 1, userId: u.id };
  u.mindsetPhrases = [...SWIM_PHRASES];
  return { changed: true, count: 1, userId: u.id };
}
