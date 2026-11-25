// Profil du coach principal → carte « Sauvegarde » : une écriture qui échoue est affichée en rouge (sinon invisible).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser;
before(async () => {
  srv = await startServer({ PORT: '3001', DB_PATH: '/proc/inexistant/prime-athl.json' });   // disque inaccessible : toute écriture échoue
  const t = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: t, body: { email: 'sv@test.local', password: 'longenough1', firstName: 'Sv', lastName: 'Err' } });
  await new Promise(r => setTimeout(r, 900));
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('la carte Sauvegarde affiche l\'échec de la dernière écriture', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(10000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  for (const t of ['Passer', 'Plus tard']) { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 1500 }); } catch {} }
  await pg.getByText('PROFIL', { exact: false }).last().click(); await pg.waitForTimeout(1200);
  const card = pg.getByTestId('save-error');
  await card.scrollIntoViewIfNeeded();
  await card.waitFor();
  assert.match(await card.innerText(), /dernière sauvegarde sur le disque a échoué/);
  assert.match(await card.innerText(), /Télécharge une sauvegarde maintenant/);
  if (process.env.SHOT) await pg.screenshot({ path: process.env.SHOT });
  assert.deepEqual(errs, []);
  await ctx.close();
});
