// Téléchargements PDF : séance (athlète), séance partagée (page publique, avec compteur), programme IA (jsPDF),
// plan nutrition (fenêtre d'impression « Enregistrer en PDF »). jsPDF est servi par /vendor (copie locale) avec le CDN
// en secours ; JSPDF_LOCAL=<chemin> (facultatif) force une autre copie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchBrowser } from './browser.js';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from '../test/helpers/server.js';

let srv, browser, coach, athleteId, atok, sid;
const EMAIL = 'e2e-pdf@test.local', PW = 'longenough1';
const pm = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
const iso = d => `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00.000Z`;
const exercises = [
  { name: 'Squat', muscle: 'JAMBES', style: 'CLASSIQUE', groupType: 'classic', sets: [{ weight: 100, reps: 8, done: true }, { weight: 100, reps: 7, done: true }] },
  { name: 'Gainage', muscle: 'ABDOS', style: 'CLASSIQUE', groupType: 'classic', holdSeconds: 45, sets: [{ weight: 0, reps: 45, done: true }] },
  { name: 'Tapis Liss', muscle: 'TAPIS', style: 'CARDIO', groupType: 'cardio', cardio: { duree: "30'", vitesse: '5', inclinaison: '8' }, sets: [{ weight: 0, reps: 0, done: true, cardio: { duree: 30, vitesse: 5, inclinaison: 8, distance: 2.5 } }] },
];

const route = async ctx => { if (process.env.JSPDF_LOCAL) await ctx.route(/jspdf\.umd\.min\.js/, r => r.fulfill({ path: process.env.JSPDF_LOCAL, contentType: 'application/javascript' })); };
async function readDownload(dl) {
  const p = await dl.path(); const buf = fs.readFileSync(p);
  return { name: dl.suggestedFilename(), size: buf.length, text: buf.toString('latin1'), head: buf.subarray(0, 5).toString('latin1'), tail: buf.subarray(-8).toString('latin1') };
}
// Nom de fichier : Chromium headless sans locale UTF-8 renomme tout nom NON ASCII en « download » (même avec un
// <a download="épaules.pdf"> natif) — ce n'est pas l'app ; on ne contrôle donc le nom que pour un nom ASCII.
// jsPDF écrit les textes en clair dans le PDF : « 1 500 » (et non « 1 /500 », l'espace fine fr-FR étant absente de la police).
const contenu = d => { assert.match(d.text, /\(1 500\) Tj/, 'volume lisible'); assert.match(d.text, /\(30 min\) Tj/, 'durée du cardio'); assert.doesNotMatch(d.text, /1 ?\/500/); assert.match(d.text, /\/Subtype \/Image/, 'logo Prime Athlète intégré'); };
const isPdf = (d, { name = true } = {}) => { if (name) assert.match(d.name, /\.pdf$/i); assert.equal(d.head, '%PDF-'); assert.match(d.tail, /%%EOF/); assert.ok(d.size > 1500, 'PDF non vide (' + d.size + ' o)'); };

before(async () => {
  srv = await startServer({ PORT: '3001' });
  coach = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coach, body: { email: EMAIL, password: PW, firstName: 'Pdf', lastName: 'Test' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: EMAIL, password: PW } });
  athleteId = la.body.user.id; atok = la.body.token;
  await api(srv.baseUrl, 'POST', `/api/access/grant/${athleteId}`, { token: coach, body: { enabled: true } });
  const pex = n => ({ name: n, muscle: 'JAMBES', restSeconds: 60, sets: [{ weight: 60, reps: 10, target: '10' }] });
  await api(srv.baseUrl, 'PUT', `/api/coach/program/${athleteId}`, { token: coach, body: { data: { PROGRAMME: { LUNDI: { category: 'JAMBES', exercises: [pex('Squat')] } } }, fileName: 'p.xlsx' } });
  const r = await api(srv.baseUrl, 'POST', `/api/coach/athletes/${athleteId}/sessions`, { token: coach, body: { name: 'JAMBES - CARDIO', date: iso(10), exercises, totalVolume: 1500 } });
  sid = r.body.session?.id || r.body.id;
  browser = await launchBrowser();
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('athlète : « Visionner séance » → bouton PDF télécharge un vrai PDF', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  await route(ctx);
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  let dialog = null; pg.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.fill('input[type=email]', EMAIL); await pg.fill('input[type=password]', PW); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(3500);
  const click = async (t, to = 1500) => { try { await pg.getByText(t, { exact: false }).first().click({ timeout: to }); await pg.waitForTimeout(700); return true; } catch { return false; } };
  for (const t of ['Passer', 'Plus tard', 'Coaching', 'Séances']) await click(t);
  await pg.getByText('‹', { exact: true }).first().click(); await pg.waitForTimeout(600);
  await pg.locator(`[data-cal-date="${iso(10).slice(0, 10)}"]`).click(); await pg.waitForTimeout(500);
  await pg.getByText('Visionner séance', { exact: false }).first().click(); await pg.waitForTimeout(800);
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), pg.getByRole('button', { name: /PDF/ }).first().click()]);
  const d = await readDownload(dl); isPdf(d); contenu(d);
  assert.equal(dialog, null, 'aucune alerte d\'erreur : ' + dialog);
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('page publique d\'une séance partagée : « Télécharger en PDF » télécharge un PDF et incrémente le compteur', async () => {
  const sh = await api(srv.baseUrl, 'POST', `/api/sessions/${sid}/share`, { token: atok });
  assert.equal(sh.status, 200);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true });
  await route(ctx);
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  let dialog = null; pg.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await pg.goto(srv.baseUrl + sh.body.url);
  await pg.locator('#pdfBtn').waitFor();
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), pg.locator('#pdfBtn').click()]);
  const d2 = await readDownload(dl); isPdf(d2); contenu(d2);
  assert.equal(dialog, null, 'aucune alerte d\'erreur : ' + dialog);
  await pg.waitForTimeout(600);
  const links = await api(srv.baseUrl, 'GET', `/api/sessions/${sid}/shares`, { token: atok });
  assert.equal(links.body.links[0].pdfDownloads, 1, 'compteur de téléchargements');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('programme IA : l\'export PDF (jsPDF) produit un PDF valide, sans alerte', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true });
  await route(ctx);
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  let dialog = null; pg.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.waitForFunction(() => window.jspdf && typeof window.exportAIProgramPDF === 'function');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), pg.evaluate(() => window.exportAIProgramPDF({
    name: 'ÉPAULES · PUSH IA', muscles: 'PECS · ÉPAULES', advice: 'Reste régulier.',
    exercises: Array.from({ length: 8 }, (_, i) => ({ name: 'Exercice ' + (i + 1), muscle: 'PECS', sets: 4, reps: '8-10', rest: '90s', tip: 'Contrôle la descente.' })) }))]);
  isPdf(await readDownload(dl), { name: false });   // nom accentué : on vérifie le contenu
  assert.equal(dialog, null, 'aucune alerte : ' + dialog);
  await ctx.close();
});

test('plan nutrition : le bouton PDF ouvre la fenêtre d\'impression (« Enregistrer en PDF ») avec le plan', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  // window.print() bloquerait le test : neutralisé avant le chargement de la fenêtre ouverte
  await ctx.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  await pg.goto(srv.baseUrl + '/Muscu.html');
  await pg.waitForFunction(() => typeof window.exportNutritionPDF === 'function');
  const plan = { weeks: [{ label: 'S1', days: { LUNDI: { meals: [{ name: 'Petit-déjeuner', items: [{ name: 'Flocons d\'avoine', qty: 80, unit: 'G', kcal: 300, p: 10, c: 54, f: 6 }] }] } } }] };
  const [popup] = await Promise.all([pg.waitForEvent('popup', { timeout: 8000 }), pg.evaluate(p => window.exportNutritionPDF(p, 'Marie Test'), plan)]);
  await popup.waitForLoadState();
  await popup.waitForFunction(() => window.__printed === true, null, { timeout: 5000 });
  const txt = await popup.evaluate(() => document.body.innerText);
  assert.match(txt, /Marie Test/); assert.match(txt, /Flocons d.avoine/);
  await ctx.close();
});

const VENDOR = new URL('../public/vendor/jspdf.umd.min.js', import.meta.url).pathname;

test('jsPDF absent au chargement (copie locale en panne) : chargé à la demande depuis le CDN, le PDF se télécharge', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true });
  await ctx.route(/\/vendor\/jspdf\.umd\.min\.js/, r => r.abort());
  await ctx.route(/cdnjs\.cloudflare\.com\/.*jspdf\.umd\.min\.js/, r => r.fulfill({ path: VENDOR, contentType: 'application/javascript' }));
  const sh = await api(srv.baseUrl, 'POST', `/api/sessions/${sid}/share`, { token: atok });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  let dialog = null; pg.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await pg.goto(srv.baseUrl + sh.body.url);
  await pg.locator('#pdfBtn').waitFor();
  assert.equal(await pg.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF)), false, 'jsPDF absent au départ');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), pg.locator('#pdfBtn').click()]);
  isPdf(await readDownload(dl));
  assert.equal(dialog, null, 'aucune alerte : ' + dialog);
  await ctx.close();
});

test('jsPDF introuvable partout : message clair (et non « réessaie dans un instant »)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true });
  await ctx.route(/jspdf\.umd\.min\.js/, r => r.abort());
  const sh = await api(srv.baseUrl, 'POST', `/api/sessions/${sid}/share`, { token: atok });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  let dialog = null; pg.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await pg.goto(srv.baseUrl + sh.body.url);
  await pg.locator('#pdfBtn').waitFor();
  await pg.locator('#pdfBtn').click();
  await pg.waitForTimeout(1500);
  assert.match(dialog || '', /bibliothèque PDF.*connexion/);
  await ctx.close();
});

test('module PDF absent au chargement (/pdf-brand.js en panne puis rétabli) : chargé à la demande', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true });
  let first = true;
  await ctx.route(/\/pdf-brand\.js/, r => { if (first) { first = false; return r.abort(); } return r.continue(); });
  const sh = await api(srv.baseUrl, 'POST', `/api/sessions/${sid}/share`, { token: atok });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(8000);
  let dialog = null; pg.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await pg.goto(srv.baseUrl + sh.body.url);
  await pg.locator('#pdfBtn').waitFor();
  assert.equal(await pg.evaluate(() => !!window.PrimePDF), false, 'module absent au départ');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }), pg.locator('#pdfBtn').click()]);
  isPdf(await readDownload(dl));
  assert.equal(dialog, null, 'aucune alerte : ' + dialog);
  await ctx.close();
});
