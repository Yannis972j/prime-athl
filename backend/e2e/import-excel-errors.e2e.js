// Import Excel : une cellule en erreur (#VALUE!…) n'est JAMAIS une charge. La décharge retombe sur le calcul auto (60 %).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchBrowser } from './browser.js';
import { startServer } from '../test/helpers/server.js';
const XLSX = createRequire(import.meta.url)('xlsx');

let srv, browser, page, bytes;
const HEAD = ['Jour', 'Style', 'Exercices', 'Muscles', 'Charge KG', 'Distance km', 'Vitesse', 'Inclinaison', 'Durée', 'Series', 'Répétions', 'Temps de repos'];
function workbook() {
  const prog = [['PUSH'], HEAD, ['LUNDI', 'CLASSIQUE', 'Squat', 'JAMBES', '100', '', '', '', '', 4, '6-8', "2'"], ['', 'CLASSIQUE', 'T-bar row', 'DOS', '72.5', '', '', '', '', 4, '6-8', "2'"]];
  const dech = [['DÉCHARGE'], ['Charges = 60 %'], [''], ['PUSH — DÉCHARGE'], HEAD, ['LUNDI', 'CLASSIQUE', 'Squat', 'JAMBES', 60, '', '', '', '', 2, '6-8', "2'"], ['', 'CLASSIQUE', 'T-bar row', 'DOS', '#VALUE!', '', '', '', '', 2, '6-8', "2'"]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prog), 'SEPTEMBRE');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dech), 'DECHARGE');
  return [...XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })];
}
before(async () => {
  srv = await startServer({ PORT: '3001' });
  bytes = workbook();
  browser = await launchBrowser();
  page = await (await browser.newContext()).newPage();
  await page.goto(srv.baseUrl + '/Muscu.html'); await page.waitForTimeout(2500);
});
after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });

test('cellule #VALUE! de la feuille DECHARGE : ignorée, avertissement, décharge à 60 % pour cette ligne', async () => {
  const r = await page.evaluate(async b => new Promise(res => parseYannisExcel(new File([new Uint8Array(b)], 'p.xlsx'), (progs, warnings) => {
    const exs = progs.SEPTEMBRE.LUNDI.exercises;
    res({ warnings, rows: exs.map(e => ({ name: e.name, w: e.weightStr, dl: e.deload ? e.deload.weightStr : null, light: lightenExercise(e, 'deload').weightStr, sets: lightenExercise(e, 'deload').sets.length })) });
  }, e => res({ err: String(e) }))), bytes);
  assert.equal(r.err, undefined);
  const squat = r.rows.find(x => x.name === 'Squat'), tbar = r.rows.find(x => x.name === 'T-bar row');
  assert.equal(squat.dl, '60', 'la valeur de la feuille DECHARGE est respectée');
  assert.equal(squat.light, '60');
  assert.equal(tbar.w, '72.5', 'le poids normal est intact');
  assert.equal(tbar.dl, '', '« #VALUE! » n\'est pas devenu une charge');
  assert.equal(tbar.light, '42.5', '72,5 × 60 % arrondi à 2,5 kg');
  assert.equal(tbar.sets, 2, 'séries de la feuille DECHARGE conservées');
  assert.ok(r.warnings.some(w => /DECHARGE.*erreur Excel.*E7/.test(w)), 'avertissement : ' + JSON.stringify(r.warnings));
});
