// Génère une feuille "LISTE PRODUITS" en 1ere position
// avec mise en page optimisée pour export PDF (titres, marges, fit-to-page).
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const FILES = [
  'C:/Users/User/Downloads/PLAN NUTRION YOHAN.xlsx',
  'C:/Users/User/Downloads/PLAN NUTRITION MICHEL.xlsx',
];

const CATEGORIES = {
  'VIANDES & POISSONS': ['BLANC DE POULET','POULET','STEAK','THON','SARDINE'],
  'ŒUFS & LAITAGES':    ['OEUF','OEUFS DURS','FROMAGE BLANC','YAOURT SPORT','PETIT SUISSE','WHEY'],
  'FÉCULENTS':          ['RIZ','POMME DE TERRE','PATATE DOUCE','LENTILLE','HARICOT ROUGE','FLOCON D\'AVOINE',"GALETTE D'EPEAUTRE",'DATTES','DATTE'],
  'LÉGUMES':            ['HARICOT VERT','BROCOLI','MACHE ROQUETTE','MACHEBETRAVE'],
  'FRUITS':             ['BANANE','POMME','KIWI','FRUIT ROUGE'],
  'MATIÈRES GRASSES':   ["HUILE D'OLIVE",'BEURRE DE CACAHOUETE','GRAINE DE CHIA','CHOCOLAT NOIR'],
  'AUTRES':             ['MIEL','CANELLE','CANNELLE'],
};

const CAT_COLORS = {
  'VIANDES & POISSONS': 'FFD97757',
  'ŒUFS & LAITAGES':    'FFC2A042',
  'FÉCULENTS':          'FFC97586',
  'LÉGUMES':            'FF7CC4A1',
  'FRUITS':             'FFE6925A',
  'MATIÈRES GRASSES':   'FF7CA8C4',
  'AUTRES':             'FF888888',
};

const CATEGORY_ORDER = ['VIANDES & POISSONS','ŒUFS & LAITAGES','FÉCULENTS','LÉGUMES','FRUITS','MATIÈRES GRASSES','AUTRES'];

function categorize(name) {
  const up = String(name).toUpperCase().trim();
  for (const [cat, list] of Object.entries(CATEGORIES)) {
    if (list.includes(up)) return cat;
  }
  return 'AUTRES';
}

async function processFile(filePath) {
  // Étape 1 : lire les feuilles existantes avec xlsx pour agréger les produits
  const wbRead = XLSX.readFile(filePath);
  const aggregate = {};
  for (const sheetName of wbRead.SheetNames) {
    if (sheetName === 'FICHE' || sheetName === 'LISTE PRODUITS') continue;
    const rows = XLSX.utils.sheet_to_json(wbRead.Sheets[sheetName], { header: 1, defval: '' });
    for (const r of rows) {
      if (!r[3]) continue;
      const label = String(r[0]).toUpperCase();
      if (label.includes('TOTAL') || r[6] === 'CALORIE') continue;
      const product = String(r[3]).trim().toUpperCase();
      const qty = parseFloat(r[4]) || 0;
      const unit = String(r[5] || '').trim().toUpperCase();
      if (!product || qty <= 0) continue;
      if (!aggregate[product]) aggregate[product] = { grams: 0, units: 0, boites: 0 };
      if (unit === 'G') aggregate[product].grams += qty;
      else if (unit === 'BOITE') aggregate[product].boites += qty;
      else aggregate[product].units += qty;
    }
  }

  const totalDays = wbRead.SheetNames.filter(n => n !== 'FICHE' && n !== 'LISTE PRODUITS').length;
  const totalProducts = Object.keys(aggregate).length;
  const fileName = filePath.split('/').pop().replace('.xlsx','').replace('nutrition BDD PRIME ATHL ','');

  // Étape 2 : créer un nouveau classeur dédié à la liste produits
  const wb = new ExcelJS.Workbook();
  const outPath = filePath.replace('.xlsx', ' - LISTE PRODUITS.xlsx');

  const ws = wb.addWorksheet('LISTE PRODUITS', {
    pageSetup: {
      orientation: 'portrait',
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,        // 1 seule page (synthétique)
      horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
      printArea: undefined,  // sera défini après
    },
    headerFooter: {
      oddFooter: `&L${fileName} — Liste des courses&R&P / &N`,
    },
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: false }],
  });

  // Largeur colonnes
  ws.columns = [
    { width: 22 },  // Catégorie
    { width: 26 },  // Produit
    { width: 18 },  // Quantité
    { width: 9 },   // Unité
    { width: 12 },  // Note
  ];

  // Titre (fusion ligne 1)
  ws.mergeCells('A1:E1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `LISTE DES COURSES — ${fileName}`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1A1A22' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5E6DC' } };
  ws.getRow(1).height = 28;

  // Sous-titre
  ws.mergeCells('A2:E2');
  const subCell = ws.getCell('A2');
  subCell.value = `Quantités totales pour ${totalDays} jours (${totalDays/7} semaine${totalDays/7>1?'s':''}) · ${totalProducts} produits`;
  subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF666666' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 20;

  // Ligne vide
  ws.getRow(3).height = 8;

  // En-têtes (ligne 4)
  const header = ws.getRow(4);
  header.values = ['CATÉGORIE','PRODUIT','QUANTITÉ','UNITÉ','NOTE'];
  header.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };
  header.height = 22;
  header.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C2C36' } };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF000000' } } };
  });

  // Construire et grouper par catégorie
  const byCategory = {};
  for (const [product, totals] of Object.entries(aggregate)) {
    const cat = categorize(product);
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ product, grams: totals.grams, units: totals.units, boites: totals.boites||0 });
  }

  let rowIdx = 5;
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory[cat];
    if (!items || items.length === 0) continue;
    items.sort((a,b) => a.product.localeCompare(b.product));

    const catColor = CAT_COLORS[cat] || 'FF888888';
    const catStartRow = rowIdx;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let displayQty = '', displayUnit = '', note = '';

      const parts = [];
      if (item.grams > 0) {
        if (item.grams >= 1000) parts.push(`${(item.grams/1000).toFixed(2)} kg`);
        else parts.push(`${Math.round(item.grams)} g`);
      }
      if (item.boites > 0) parts.push(`${Math.round(item.boites)} ${item.boites > 1 ? 'boîtes' : 'boîte'}`);
      if (item.units > 0) parts.push(`${Math.round(item.units)} ${item.units > 1 ? 'unités' : 'unité'}`);

      if (parts.length > 1) {
        displayQty = parts.join(' + ');
        displayUnit = '';
      } else if (item.grams > 0) {
        displayQty = item.grams >= 1000 ? (item.grams/1000).toFixed(2) : Math.round(item.grams);
        displayUnit = item.grams >= 1000 ? 'kg' : 'g';
        if (item.grams >= 1000) note = `${Math.round(item.grams)} g`;
      } else if (item.boites > 0) {
        displayQty = Math.round(item.boites);
        displayUnit = item.boites > 1 ? 'boîtes' : 'boîte';
      } else {
        displayQty = Math.round(item.units);
        displayUnit = item.units > 1 ? 'unités' : 'unité';
      }

      const row = ws.getRow(rowIdx);
      row.values = [i === 0 ? cat : '', item.product, displayQty, displayUnit, note];
      row.height = 18;

      // Style produit
      const cellProd = row.getCell(2);
      cellProd.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1A1A22' } };
      cellProd.alignment = { horizontal: 'left', vertical: 'middle' };

      const cellQty = row.getCell(3);
      cellQty.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1A1A22' } };
      cellQty.alignment = { horizontal: 'center', vertical: 'middle' };

      const cellUnit = row.getCell(4);
      cellUnit.font = { name: 'Calibri', size: 10, color: { argb: 'FF555555' } };
      cellUnit.alignment = { horizontal: 'center', vertical: 'middle' };

      const cellNote = row.getCell(5);
      cellNote.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF999999' } };
      cellNote.alignment = { horizontal: 'center', vertical: 'middle' };

      // Lignes alternées
      if (i % 2 === 1) {
        for (let c = 2; c <= 5; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F8F6' } };
        }
      }

      // Bordure du bas
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
      });

      rowIdx++;
    }

    // Fusionner la catégorie et la styler verticalement
    if (items.length > 1) {
      ws.mergeCells(catStartRow, 1, rowIdx - 1, 1);
    }
    const catCell = ws.getCell(catStartRow, 1);
    catCell.value = cat;
    catCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    catCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    catCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: catColor } };
    catCell.border = { right: { style: 'medium', color: { argb: 'FF000000' } } };

    // Petit espace entre catégories
    ws.getRow(rowIdx).height = 4;
    rowIdx++;
  }

  ws.pageSetup.printTitlesRow = '4:4';
  ws.pageSetup.printArea = `A1:E${rowIdx - 1}`;

  await wb.xlsx.writeFile(outPath);

  console.log(`\n=== ${fileName} ===`);
  console.log(`  Feuilles : ${totalDays} jours · ${totalProducts} produits`);
  for (const cat of CATEGORY_ORDER) {
    if (byCategory[cat]) console.log(`  ${cat.padEnd(22)} : ${byCategory[cat].length} produits`);
  }
}

(async () => {
  for (const file of FILES) {
    try { await processFile(file); }
    catch (e) { console.error(`ERREUR ${file} :`, e.message); }
  }
  console.log('\nOK — Fichiers "LISTE PRODUITS" générés dans Downloads.');
})();
