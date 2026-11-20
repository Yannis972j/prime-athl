// Renommer une séance DÉJÀ FAITE pour que le récap « Dernière fois » la retrouve (la comparaison se
// fait sur le NOM de séance). Athlète : panneau « Visionner séance » ; coach : fenêtre récap.
// Avant renommage : la séance « JOUR 1 » n'a pas de précédente du même nom → pas de « Dernière fois ».
// Après : elle reprend le nom « BAS DU CORPS » de la séance d'avant → « Dernière fois 600 kg ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, athleteId, atok, sidOld, sidNew, sidOld2, sidNew2;
const EMAIL = 'e2e-rename@test.local', PW = 'longenough1';
const SHOT = process.env.SHOT_DIR;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Mois PRÉCÉDENT : toujours dans le passé (le serveur refuse les séances faites datées du futur).
const pm = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
const day = d => `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const iso = d => `${day(d)}T12:00:00.000Z`;
const ex = w => ({ name: 'Squat', muscle: 'JAMBES', style: 'MUSCU', groupType: 'classic', sets: [{ weight: w, reps: 10, done: true }] });
const mine = async () => (await api(srv.baseUrl, 'GET', '/api/sessions', { token: atok })).body;

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PW, firstName: 'Rena', lastName: 'Me' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PW } });
  athleteId = la.body.user.id; atok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coach, body: { enabled: true } });
  const pex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 60, sets: [{ weight: 60, reps: 10, target: '10' }] });
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${athleteId}`, { token: coach, body: { data: { PROGRAMME: { LUNDI: { category: 'JAMBES', exercises: [pex('Squat')] } } }, fileName: 'p.xlsx' } });
  const post = b => api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body: b });
  const id = r => r.body.session?.id || r.body.id;
  // Test athlète : « BAS DU CORPS » (600 kg) puis « JOUR 1 » (800 kg)
  sidOld = id(await post({ name: 'BAS DU CORPS', date: iso(3), exercises: [ex(60)], totalVolume: 600 }));
  sidNew = id(await post({ name: 'JOUR 1', date: iso(10), exercises: [ex(80)], totalVolume: 800 }));
  // Test coach : « HAUT DU CORPS » (500 kg) puis « JOUR 2 » (700 kg)
  sidOld2 = id(await post({ name: 'HAUT DU CORPS', date: iso(5), exercises: [ex(50)], totalVolume: 500 }));
  sidNew2 = id(await post({ name: 'JOUR 2', date: iso(12), exercises: [ex(70)], totalVolume: 700 }));
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('serveur : le renommage est enregistré (athlète sur ses séances, coach sur celles de son athlète) et refusé sur celles des autres', async () => {
  let r = await api(srv.baseUrl, 'PATCH', `/api/sessions/${sidNew}`, { token: atok, body: { name: '  BAS DU CORPS  ' } });
  assert.equal(r.status, 200);
  assert.ok(['BAS DU CORPS', '  BAS DU CORPS  '].includes(r.body.session.name));
  // remis comme au départ pour le test UI
  await api(srv.baseUrl, 'PATCH', `/api/sessions/${sidNew}`, { token: atok, body: { name: 'JOUR 1' } });
  assert.equal((await mine()).find(s => s.id === sidNew).name, 'JOUR 1');
  // un autre athlète ne peut pas renommer
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: 'e2e-rename2@test.local', password: PW, firstName: 'Autre', lastName: 'Ath' } });
  const o = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'e2e-rename2@test.local', password: PW } });
  r = await api(srv.baseUrl, 'PATCH', `/api/sessions/${sidNew}`, { token: o.body.token, body: { name: 'PIRATE' } });
  assert.equal(r.status, 403);
  assert.equal((await mine()).find(s => s.id === sidNew).name, 'JOUR 1');
});

test('athlète (UI) : renommer « JOUR 1 » en « BAS DU CORPS » fait apparaître « Dernière fois 600 kg »', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 1500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) await click(t);
  await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(600);
  await pg.locator(`[data-cal-date="${day(10)}"]`).click(); await pg.waitForTimeout(500);
  await pg.getByText('Visionner séance', { exact: false }).first().click(); await pg.waitForTimeout(800);
  let txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /JOUR 1/);
  assert.doesNotMatch(txt, /Dernière fois/, 'nom différent de la séance précédente : pas de comparaison');
  await pg.getByTestId('rename-session').click();
  const input = pg.getByTestId('rename-input');
  await input.waitFor();
  assert.match(await pg.getByTestId('rename-form').innerText(), /même nom/i, 'explication affichée');
  // la liste de choix propose le nom de la séance précédente
  const opts = await pg.evaluate(() => [...document.querySelectorAll('datalist option')].map(o => o.value));
  assert.ok(opts.includes('BAS DU CORPS'), 'noms existants proposés : ' + opts.join('|'));
  if (SHOT) await pg.screenshot({ path: `${SHOT}/rename-1-athlete-form.png` });
  // champ vide : refusé
  await input.fill('   ');
  assert.equal(await pg.getByTestId('rename-save').isDisabled(), true);
  await input.fill('BAS DU CORPS');
  await pg.getByTestId('rename-save').click();
  await pg.getByTestId('rename-session').waitFor();
  await pg.waitForTimeout(500);
  txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /BAS DU CORPS/);
  assert.match(txt, /Dernière fois/, 'la comparaison apparaît après renommage');
  assert.match(txt, /600\s*kg/, 'volume de la séance précédente');
  assert.match(txt, /800\s*kg/, 'volume de cette séance');
  if (SHOT) await pg.screenshot({ path: `${SHOT}/rename-2-athlete-after.png` });
  assert.equal((await mine()).find(s => s.id === sidNew).name, 'BAS DU CORPS', 'enregistré côté serveur');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('coach (UI) : renommer « JOUR 2 » en « HAUT DU CORPS » met le récap à jour sans fermer la fenêtre', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', MAIN_COACH_EMAIL); await pg.fill('input[type=password]', MAIN_COACH_PASSWORD); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3000);
  const click = async (t, to = 2500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(800); return true; } catch { return false; } };
  await click('Rena'); await click('Séances');
  await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(600);
  await pg.locator(`[data-cal-date="${day(12)}"]`).click(); await pg.waitForTimeout(600);
  await pg.getByText('Voir', { exact: true }).first().click(); await pg.waitForTimeout(1200);
  let txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /JOUR 2/);
  assert.doesNotMatch(txt, /Dernière fois/);
  await pg.getByTestId('rename-session').click();
  await pg.getByTestId('rename-input').fill('HAUT DU CORPS');
  await pg.getByTestId('rename-save').click();
  await pg.getByTestId('rename-session').waitFor();
  await pg.waitForTimeout(700);
  await pg.locator('button', { hasText: /^📊\s*Récap$/ }).first().click(); await pg.waitForTimeout(700);
  txt = await pg.evaluate(() => document.body.innerText);
  assert.match(txt, /HAUT DU CORPS/, 'la fenêtre est restée ouverte avec le nouveau nom');
  assert.match(txt, /Dernière fois/);
  assert.match(txt, /500\s*kg/);
  if (SHOT) await pg.screenshot({ path: `${SHOT}/rename-3-coach-after.png` });
  assert.equal((await mine()).find(x => x.id === sidNew2)?.name, 'HAUT DU CORPS', 'enregistré côté serveur');
  assert.deepEqual(errs, []);
  await ctx.close();
});
