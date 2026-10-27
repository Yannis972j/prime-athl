// Lancement du navigateur des tests e2e.
// IMPORTANT : on utilise le Chromium COMPLET (mode « new headless », channel 'chromium') et non le
// « chrome-headless-shell » par défaut de Playwright : ce dernier n'a pas l'API Push (PushManager) ni
// un service worker utilisable pour les notifications — l'invitation « Active les notifications »
// n'y apparaît jamais, alors qu'elle s'affiche sur un vrai navigateur. Hors CI, E2E_CHROMIUM peut
// pointer vers un Chromium local.
import { chromium } from 'playwright-core';

export function launchBrowser() {
  const exe = process.env.E2E_CHROMIUM;
  return chromium.launch({
    ...(exe ? { executablePath: exe } : { channel: 'chromium' }),
    args: ['--no-sandbox'],
  });
}
