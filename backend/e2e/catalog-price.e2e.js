// Catalogue : prix gratuit ou 9,99–499 € — refusé par le serveur ET signalé dans le formulaire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach;
const SHOT = process.env.SHOT_DIR;
before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

const post = price => api(srv.baseUrl, 'POST', '/api/admin/training-programs', { token: coach, body: { name: 'Prog ' + price, price } });

test('serveur : prix hors bornes refusés (création et modification), bornes acceptées', async () => {
  for (const bad of [1, 998, 49901, 1000000, -500]) assert.equal((await post(bad)).body.error, 'invalid_price', String(bad));
  for (const ok of [0, 999, 2990, 49900]) assert.equal((await post(ok)).status, 200, String(ok));
  const p = (await post(2990)).body;
  const put = body => api(srv.baseUrl, 'PUT', `/api/admin/training-programs/${p.id}`, { token: coach, body });
  assert.equal((await put({ price: 50 })).body.error, 'invalid_price');
  assert.equal((await put({ price: 99999 })).body.error, 'invalid_price');
  const okPut = await put({ price: 4990, name: 'Renommé' });
  assert.equal(okPut.body.price, 4990);
  // le prix inchangé ne bloque pas la modification des autres champs
  assert.equal((await put({ price: 4990, name: 'Encore' })).body.name, 'Encore');
});

test('formulaire : message clair sous le champ prix, rien n\'est enregistré', async () => {
  const p = (await post(2990)).body;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  await pg.locator('button[title="Gérer le catalogue"]').click(); await pg.waitForTimeout(1200);
  await pg.getByText('Modifier', { exact: false }).first().click(); await pg.waitForTimeout(1000);
  const price = pg.getByTestId('catalog-price');
  await price.scrollIntoViewIfNeeded();
  await price.fill('5'); // 5 € : trop bas
  await pg.getByText('Sauver', { exact: true }).first().click(); await pg.waitForTimeout(600);
  const err = await pg.getByTestId('catalog-price-err').innerText();
  assert.match(err, /9,99 € et 499 €/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/catalog-price-err.png` });
  const list = (await api(srv.baseUrl, 'GET', '/api/admin/training-programs', { token: coach })).body;
  assert.equal((Array.isArray(list) ? list : list.programs || []).find(x => x.id === p.id)?.price, 2990, 'prix inchangé');
  await price.fill('39.9');
  assert.equal(await pg.getByTestId('catalog-price-err').count(), 0, 'erreur effacée dès que l\'on corrige');
  assert.deepEqual(errs, []);
  await ctx.close();
});
