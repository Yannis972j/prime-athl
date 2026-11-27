// Le coach peut renommer un exercice d'une séance déjà réalisée (« Corriger la séance »).
// Serveur : nom nettoyé (espaces, 120 car.), l'athlète voit le nouveau nom. UI : champ nom modifiable,
// mention « Renommé · avant : … », nom vidé = enregistrement bloqué (pas de suppression silencieuse).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, id, atok, sid, day;
const PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const exo = (name, muscle, w) => ({ name, muscle, style: 'MUSCU', groupType: 'classic', sets: [1, 2, 3].map(() => ({ weight: w, reps: 10 })) });
const mySession = async () => (await api(srv.baseUrl, 'GET', '/api/sessions', { token: atok })).body.find(x => x.id === sid);

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'rn@test.local', password: PW, firstName: 'Rita', lastName: 'Nom' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'rn@test.local', password: PW } });
  id = la.body.user.id; atok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/universes/${id}`, { token: coach, body: { all: true } });
  // Un programme assigné : l'écran « Séances » de l'athlète affiche alors son calendrier.
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${id}`, { token: coach, body: { data: { PROGRAMME: { LUNDI: { category: 'PULL', exercises: [{ name: 'Curl biceps assistée', muscle: 'BICEPS', sets: [{ weight: 20, reps: 10 }] }] } } }, fileName: 'p.xlsx' } });
  const d = new Date(Date.now() - 2 * 86400000); day = ymd(d);
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${id}/sessions`, {
    token: coach, body: { name: 'PULL · DOS / BICEPS', date: d.toISOString(), exercises: [exo('Curl biceps assistée', 'BICEPS', 20), exo('Crunch à la poulie', 'ABDOS', 35)] },
  });
  sid = r.body.session?.id || r.body.id;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('serveur : renommer un exercice garde les séries, nettoie le nom, refuse de le perdre', async () => {
  const s0 = await mySession();
  const patch = exercises => api(srv.baseUrl, 'PATCH', `/api/coach/sessions/${sid}`, { token: coach, body: { exercises, totalVolume: 0 } });
  const ex = JSON.parse(JSON.stringify(s0.exercises));
  ex[0].name = '   Curl biceps machine  ';
  const r = await patch(ex);
  assert.equal(r.status, 200);
  const s1 = await mySession();
  assert.equal(s1.exercises[0].name, 'Curl biceps machine', 'espaces retirés');
  assert.equal(s1.exercises[0].sets.length, 3); assert.equal(s1.exercises[0].sets[0].weight, 20);
  assert.equal(s1.exercises[1].name, 'Crunch à la poulie');
  ex[0].name = 'x'.repeat(300);
  await patch(ex);
  assert.equal((await mySession()).exercises[0].name.length, 120);
  ex[0].name = 'Curl biceps assistée'; await patch(ex);
});

test('athlète : ne peut pas renommer les exercices d\'une séance via la route coach', async () => {
  const r = await api(srv.baseUrl, 'PATCH', `/api/coach/sessions/${sid}`, { token: atok, body: { exercises: [] } });
  assert.ok([401, 403].includes(r.status));
  assert.equal((await mySession()).exercises.length, 2);
});

test('coach (UI) : renommer, voir « avant », nom vidé bloqué, enregistrer', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Rita'); await click('Séances');
  const now = new Date(), want = new Date(day + 'T12:00:00');
  for (let i = 0; i < (now.getFullYear() - want.getFullYear()) * 12 + now.getMonth() - want.getMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${day}"]`).click(); await pg.waitForTimeout(600);
  await pg.getByText('Corriger', { exact: false }).first().click(); await pg.waitForTimeout(800);

  const names = pg.getByTestId('edit-ex-name');
  await names.first().waitFor();
  assert.equal(await names.count(), 2);
  assert.equal(await names.first().inputValue(), 'Curl biceps assistée');
  assert.equal(await pg.getByTestId('edit-ex-renamed').count(), 0, 'rien de renommé au départ');

  await names.first().fill('Curl biceps machine');
  await pg.getByTestId('edit-ex-renamed').first().waitFor();
  assert.match(await pg.getByTestId('edit-ex-renamed').first().innerText(), /avant : Curl biceps assistée/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/rn-1-renomme.png` });

  // nom vidé : enregistrement refusé, rien n'est supprimé côté serveur
  await names.nth(1).fill('');
  await pg.getByText('Enregistrer les corrections', { exact: false }).click(); await pg.waitForTimeout(600);
  await pg.getByText('n\'a plus de nom', { exact: false }).waitFor();
  assert.equal((await mySession()).exercises.length, 2);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/rn-2-nom-vide.png` });

  await names.nth(1).fill('Crunch poulie haute');
  await pg.getByText('Enregistrer les corrections', { exact: false }).click();
  await pg.getByText('Séance corrigée', { exact: false }).waitFor();
  await pg.waitForTimeout(1500);
  const s = await mySession();
  assert.deepEqual(s.exercises.map(e => e.name), ['Curl biceps machine', 'Crunch poulie haute']);
  assert.equal(s.exercises[0].sets[0].weight, 20, 'séries conservées');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('athlète (UI) : voit les noms corrigés par le coach dans sa séance', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', 'rn@test.local'); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 1500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) await click(t);
  const now = new Date(), want = new Date(day + 'T12:00:00');
  for (let i = 0; i < (now.getFullYear() - want.getFullYear()) * 12 + now.getMonth() - want.getMonth(); i++) { await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(300); }
  await pg.locator(`[data-cal-date="${day}"]`).click(); await pg.waitForTimeout(500);
  await pg.getByText('Visionner séance', { exact: false }).first().click(); await pg.waitForTimeout(900);
  const txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /Curl biceps machine/); assert.match(txt, /Crunch poulie haute/);
  assert.doesNotMatch(txt, /Curl biceps assistée/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/rn-3-athlete.png` });
  assert.deepEqual(errs, []);
  await ctx.close();
});
