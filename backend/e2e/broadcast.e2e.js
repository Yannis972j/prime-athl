// Annonce groupée : le coach l'écrit dans l'appli, chaque athlète la reçoit en pop-up et la valide une seule fois.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser;
const PW = 'longenough1';
const TITLE = 'Salle fermée samedi', MSG = 'La salle est fermée ce samedi.\nRendez-vous lundi pour la reprise 💪';

before(async () => {
  srv = await startServer({ PORT: '3001' });
  const coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  for (const [email, fn] of [['bce-ana@test.local', 'Ana'], ['bce-ben@test.local', 'Ben']])
    await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email, password: PW, firstName: fn, lastName: 'Test' } });
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

async function open(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(10000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', email); await pg.fill('input[type=password]', password); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  for (const t of ['Passer', 'Plus tard']) { try { await pg.getByText(t, { exact: false }).first().click({ timeout: 1200 }); await pg.waitForTimeout(400); } catch {} }
  return { ctx, pg, errs };
}

test('coach : rédige, confirme, envoie → « envoyée à 2 athlètes » ; rien ne part sans confirmation', async () => {
  const { ctx, pg, errs } = await open(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD);
  await pg.getByTestId('open-broadcast').click();
  const send = pg.getByTestId('broadcast-send');
  await send.waitFor();
  assert.equal(await send.isDisabled(), true, 'bouton inactif tant que titre et message sont vides');
  await pg.getByTestId('broadcast-title').fill(TITLE);
  await pg.getByTestId('broadcast-message').fill(MSG);
  await pg.waitForFunction(() => /Envoyer à 2 athlètes/.test(document.body.innerText));
  await send.click();
  assert.match(await pg.getByTestId('broadcast-modal').innerText(), /Envoyer cette annonce à 2 athlètes maintenant/);
  assert.equal((await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'bce-ana@test.local', password: PW } })).status, 200);
  await pg.getByTestId('broadcast-confirm').click();
  const done = pg.getByTestId('broadcast-done');
  await done.waitFor();
  assert.match(await done.innerText(), /Annonce envoyée à 2 athlètes/);
  assert.match(await done.innerText(), /Pop-up/);
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/broadcast-coach.png' });
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('athlète : pop-up à l\'ouverture, validé une fois, ne revient pas ; l\'autre athlète le reçoit aussi', async () => {
  const ana = await open('bce-ana@test.local', PW);
  const popup = ana.pg.getByTestId('broadcast-popup');
  await popup.waitFor();
  const txt = await popup.innerText();
  assert.match(txt, /Salle fermée samedi/);
  assert.match(txt, /Rendez-vous lundi/);
  if (process.env.SHOT_DIR) await ana.pg.screenshot({ path: process.env.SHOT_DIR + '/broadcast-athlete.png' });
  await ana.pg.getByTestId('broadcast-ok').click();
  assert.equal(await ana.pg.getByTestId('broadcast-popup').count(), 0, 'pop-up fermé');
  await ana.pg.reload(); await ana.pg.waitForTimeout(3000);
  assert.equal(await ana.pg.getByTestId('broadcast-popup').count(), 0, 'ne revient pas après rechargement');
  // Ben n'a rien validé : il le voit encore
  const ben = await open('bce-ben@test.local', PW);
  await ben.pg.getByTestId('broadcast-popup').waitFor();
  assert.match(await ben.pg.getByTestId('broadcast-popup').innerText(), /Salle fermée samedi/);
  assert.deepEqual([...ana.errs, ...ben.errs], []);
  await ana.ctx.close(); await ben.ctx.close();
});

test('coach : l\'historique indique « Lue par 1/2 » après la validation d\'Ana', async () => {
  const { ctx, pg } = await open(MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD);
  await pg.getByTestId('open-broadcast').click();
  await pg.getByTestId('broadcast-modal').waitFor();
  await pg.waitForFunction(() => /Lue par 1\/2/.test(document.body.innerText));
  await ctx.close();
});
