// Prix du catalogue (achat unique) : gratuit (0) ou entre 9,99 € et 499 €. Montants en centimes.
export const CATALOG_MIN_CENTS = 999;
export const CATALOG_MAX_CENTS = 49900;

// Retourne le prix en centimes (entier) s'il est valide, sinon null. undefined/'' = 0 (gratuit).
export function validCatalogPriceCents(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n === 0) return 0;
  return n >= CATALOG_MIN_CENTS && n <= CATALOG_MAX_CENTS ? n : null;
}
