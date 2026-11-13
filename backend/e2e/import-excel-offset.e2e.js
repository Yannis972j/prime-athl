// Import Excel : tableau qui commence en colonne B (plage « B1:M… ») — les colonnes ne doivent pas être décalées.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchBrowser } from './browser.js';
import { startServer } from '../test/helpers/server.js';
const XLSX = createRequire(import.meta.url)('xlsx');

let srv, browser, page, bytes;
const HEAD = ['Jour', 'Style', 'Exercices', 'Muscle', 'Charge KG', 'Distance km', 'Vitesse', 'Inclinaison', 'Durée', 'Series', 'Repetions', 'Temps de repos'];
before(async () => {
  srv = await startServer({ PORT: '3001' });
  const rows = [
    ['PEC - TRICEPS'], HEAD,
    ['', 'CLASSIQUE', 'Développé couché', 'PEC', 135, '', '', '', '', 4, '8-10', "2'"],
    ['', 'SUPERSET', 'Écarté haltères', 'PEC', '12,5-15', '', '', '', '', 3, '10-12', "1'30"],
    ['', 'CARDIO', 'Tapis de course (marche inclinée)', '', '', '', '4-5,5', '8-10', "25'", '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows, { origin: 'B1' }); // tableau décalé d'une colonne
  ws['!ref'] = 'B1:M5'; // comme le fichier réel (Excel écrit la dimension « B1:M1000 »)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Feuille 1');
  bytes = [...XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })];
  const chk = XLSX.read(Buffer.from(bytes), { type: 'buffer' }).Sheets['Feuille 1']['!ref'];
  assert.match(chk, /^B1:/, 'le fichier de test commence bien en colonne B : ' + chk);
  browser = await launchBrowser();
  page = await (await browser.newContext()).newPage();
  await page.goto(srv.baseUrl + '/Muscu.html'); await page.waitForTimeout(2500);
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('tableau en colonne B : répétitions, repos, cardio et virgule décimale lus correctement', async () => {
  const r = await page.evaluate(async b => new Promise(res => parseYannisExcel(new File([new Uint8Array(b)], 'p.xlsx'), (progs, warnings, lib) => {
    res({ lib: (lib || []).map(s => s.exercises.map(e => ({ n: e.name, reps: e.repsStr, rest: e.restSeconds, sets: e.sets.length, w: e.sets[0].weight, c: e.cardio }))) });
  }, e => res({ err: String(e) }))), bytes);
  assert.equal(r.err, undefined);
  const [dc, ec, tapis] = r.lib[0];
  assert.deepEqual([dc.reps, dc.rest, dc.sets], ['8-10', 120, 4], 'ni « 4 » (séries) à la place des reps, ni repos par défaut');
  assert.deepEqual([ec.reps, ec.rest, ec.sets, ec.w], ['10-12', 90, 3, 12.5], 'virgule décimale : 12,5 et non 12');
  assert.deepEqual([tapis.c.vitesse, tapis.c.inclinaison, tapis.c.duree], ['4-5,5', '8-10', "25'"], 'cardio non décalé');
});
