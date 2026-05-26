// Régénère le programme nutritionnel de YOHAN
// Cible : ~2200 kcal | P200 | C220 | L70  (tolérance ±10%)
const XLSX = require('xlsx');
const SRC = 'C:/Users/User/Downloads/PLAN NUTRION YOHAN.xlsx';
const OUT = 'C:/Users/User/Downloads/PLAN NUTRION YOHAN.xlsx';

// Portions : [nom, qty, unite, kcal, C, P, L]
const F = {
  DATTES_40:        ['DATTES',40,'G',118.8,26.8,0.84,0],
  WHEY_30:          ['WHEY',30,'G',119,1.35,27.6,0.5],
  WHEY_20:          ['WHEY',20,'G',79,0.9,18.4,0.33],
  BP_100:           ['BLANC DE POULET',100,'G',106,0.6,21,2.2],
  BP_150:           ['BLANC DE POULET',150,'G',159,0.9,31.5,3.3],
  FB_250:           ['FROMAGE BLANC',250,'G',147.5,11.75,20,0],
  AVN_50:           ["FLOCON D'AVOINE",50,'G',182.5,28.5,6.5,3.4],
  AVN_60:           ["FLOCON D'AVOINE",60,'G',219,34.2,7.8,4.08],
  BC_20:            ['BEURRE DE CACAHOUETE',20,'G',125.8,2.6,5.2,10.2],
  BC_30:            ['BEURRE DE CACAHOUETE',30,'G',188.7,3.9,7.8,15.3],
  BC_40:            ['BEURRE DE CACAHOUETE',40,'G',251.6,5.2,10.4,20.4],
  KIWI_100:         ['KIWI',1,'U',48,11.3,0,0],
  HV_200:           ['HARICOT VERT',200,'G',81.8,16.48,2.36,0],
  HV_300:           ['HARICOT VERT',300,'G',122.7,24.72,3.54,0],
  HUILE_10:         ["HUILE D'OLIVE",10,'G',82.2,0,0,9.1],
  HUILE_5:          ["HUILE D'OLIVE",5,'G',41.1,0,0,4.55],
  POULET_150:       ['POULET',150,'G',153,1.95,31.5,2.25],
  POULET_100:       ['POULET',100,'G',102,1.3,21,1.5],
  PDT_150:          ['POMME DE TERRE',150,'G',111,23.7,3,0.3],
  PDT_100:          ['POMME DE TERRE',100,'G',74,15.8,2,0.2],
  POMME_150:        ['POMME',150,'G',78,20.72,0.39,0.26],
  OD_2U:            ['OEUFS DURS',2,'U',134,0.52,13.5,8.62],
  OD_3U:            ['OEUFS DURS',3,'U',201,0.78,20.25,12.93],
  SARDINE_2U:       ['SARDINE',2,'BOITE',321,0,39.6,18.15],
  BANANE_100:       ['BANANE',100,'G',90,21,1,0.33],
  BANANE_1U:        ['BANANE',1,'U',67.5,14.11,0.75,0.25],
  GALETTE_16:       ["GALETTE D'EPEAUTRE",1,'U',28.9,4.88,1.6,0.15],
  MIEL_10:          ['MIEL',10,'G',28.9,7.14,0,0],
  OEUF_1U:          ['OEUF',1,'U',73.7,0.29,7.43,4.74],
  OEUF_2U:          ['OEUF',2,'U',147.4,0.58,14.86,9.48],
  MACHE_200:        ['MACHE ROQUETTE',200,'G',42,2.6,4.6,0],
  THON_1U:          ['THON',1,'BOITE',99,0,23,0.5],
  YAOURT_1U:        ['YAOURT SPORT',1,'U',113,5.9,20,0],
  LENTILLE_100:     ['LENTILLE',100,'G',103,12.2,8.6,0.4],
  STEAK_1U:         ['STEAK',1,'U',153,0.61,12.16,11.4],
  CHIA_5:           ['GRAINE DE CHIA',5,'G',22.7,0.12,1.15,1.55],
  CHOC_10:          ['CHOCOLAT NOIR',10,'G',61.1,2.44,1.04,4.96],
  FRUIT_ROUGE:      ['FRUIT ROUGE',100,'G',49,8.7,0.9,0],
  BROCOLI_200:      ['BROCOLI',200,'G',70,14.25,4.74,0.82],
  PATATE_DOUCE:     ['PATATE DOUCE',100,'G',62.8,12.2,1.69,0.15],
  PETIT_SUISSE_2U:  ['PETIT SUISSE',2,'U',140,7,8,8],
  RIZ_100:          ['RIZ',100,'G',115,25,3,0.3],
};

// 7 jours — cible ~2200 kcal | P200 | C220 | L70 (tolérance ±10%)
// Totaux calculés : LUNDI 2311 | MARDI 2320 | MERCREDI 2420 | JEUDI 2332 | VENDREDI 2322 | SAMEDI 2325 | DIMANCHE 2342
const DAYS = {
  LUNDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BP_100'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_50','BC_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','RIZ_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','BANANE_100','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','HUILE_5','SARDINE_2U'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  MARDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','BANANE_100','GALETTE_16','MIEL_10','WHEY_30'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_60','BC_20','CHIA_5'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','PDT_150'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_3U','KIWI_100'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_5','BP_150','PDT_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_30','FRUIT_ROUGE'] },
  },
  MERCREDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_100','WHEY_30','OEUF_1U','GALETTE_16'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_60','BC_30','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','STEAK_1U','PDT_150','YAOURT_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','BANANE_1U','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_5','BP_150','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  JEUDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY_20','BANANE_100','AVN_50'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','CHIA_5','BC_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','HV_200','STEAK_1U','OEUF_1U','YAOURT_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','BANANE_100','DATTES_40'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_300','THON_1U','HUILE_10','CHOC_10','BP_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  VENDREDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BANANE_100'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_50','BC_30','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','PDT_150'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','POMME_150','GALETTE_16'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','HUILE_5','SARDINE_2U'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  SAMEDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','BP_100','DATTES_40'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BANANE_100','BC_40','AVN_60'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['PDT_150','POULET_150','BROCOLI_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_3U','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['PATATE_DOUCE','MACHE_200','THON_1U','OEUF_1U','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20','WHEY_20'] },
  },
  DIMANCHE: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BP_100'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','GALETTE_16','BC_30','BANANE_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','RIZ_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['PETIT_SUISSE_2U','OEUF_1U','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','POULET_150','PDT_150','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_30','FRUIT_ROUGE'] },
  },
};

// Semaine 3 — sardine/thon au déj ou dîner, légumineuses variées, riz plus présent
const DAYS_W3_Y = {
  'LUNDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BP_100','OEUF_1U'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_50','BC_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','STEAK_1U','PDT_150','YAOURT_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','BANANE_100','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','THON_1U','MACHE_200','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  'MARDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_100','WHEY_30','GALETTE_16','AVN_50'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BC_30','KIWI_100','CHIA_5'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','HV_200','BP_150','OEUF_1U','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_3U','POMME_150','DATTES_40'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_5','POULET_150','PDT_150'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20','FRUIT_ROUGE'] },
  },
  'MERCREDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','BANANE_1U','WHEY_30','GALETTE_16'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_50','BC_30','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','RIZ_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','BANANE_100','BC_20'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','HUILE_5','THON_1U','PDT_100','YAOURT_1U'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  'JEUDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY_20','BANANE_100','AVN_60','CHIA_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BC_30','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','BP_150','RIZ_100','OEUF_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','POMME_150','GALETTE_16'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_5','BP_150','PATATE_DOUCE','RIZ_100','OEUF_1U'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  'VENDREDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BP_100','GALETTE_16'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_60','BC_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','STEAK_1U','PDT_150'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_1U','BANANE_100','CHIA_5'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_300','HUILE_5','THON_1U','BP_100','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_30','CHIA_5'] },
  },
  'SAMEDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','BP_100','DATTES_40','WHEY_20'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_60','BC_30','CHIA_5'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','HV_200','POULET_150','HUILE_10'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_3U','KIWI_100','DATTES_40'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_5','THON_1U','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20','BANANE_1U'] },
  },
  'DIMANCHE 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BP_100','MIEL_10'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','GALETTE_16','BC_30','BANANE_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','RIZ_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['PETIT_SUISSE_2U','OEUF_1U','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','HUILE_5','BP_150','PDT_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_30','FRUIT_ROUGE'] },
  },
};

// Semaine 4 — avoine au petit déj, chocolat noir, combinaisons légumes différentes
const DAYS_W4_Y = {
  'LUNDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['AVN_60','WHEY_30','BP_100','CHOC_10'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BC_20','BANANE_100','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','PDT_150'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','POMME_150','GALETTE_16'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_10','POULET_150','RIZ_100','PATATE_DOUCE'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  'MARDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','BANANE_100','WHEY_30'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BC_30','KIWI_100','CHIA_5'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['BROCOLI_200','HUILE_10','BP_150','PDT_150','YAOURT_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','BANANE_100','CHOC_10'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','HUILE_5','BP_150','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20','FRUIT_ROUGE'] },
  },
  'MERCREDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_100','WHEY_30','AVN_50','GALETTE_16'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BC_30','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_300','HUILE_10','BP_150','PDT_150'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','BANANE_1U','BC_20'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_5','THON_1U','PATATE_DOUCE','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  'JEUDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['AVN_60','WHEY_20','BP_100','MIEL_10'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','CHIA_5','BC_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_10','POULET_150','RIZ_100','OEUF_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','BANANE_100','CHOC_10'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','HUILE_5','THON_1U','PDT_100','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20'] },
  },
  'VENDREDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BANANE_100','GALETTE_16'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','AVN_50','BC_30','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','HV_200','STEAK_1U','YAOURT_1U','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_2U','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','HUILE_5','THON_1U','BP_100','RIZ_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_30'] },
  },
  'SAMEDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','AVN_60','BP_100','CHOC_10','DATTES_40'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','BANANE_100','BC_20'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['BROCOLI_200','POULET_150','RIZ_100','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OD_3U','KIWI_100','GALETTE_16'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_200','HUILE_10','THON_1U','PATATE_DOUCE'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_20','WHEY_20'] },
  },
  'DIMANCHE 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY_30','BP_100','AVN_50'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FB_250','GALETTE_16','BC_20','BANANE_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HV_200','HUILE_5','POULET_150','RIZ_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['PETIT_SUISSE_2U','OEUF_1U','POMME_150'] },
    'DINNER':      { time: '19H - 21H',items: ['HV_200','POULET_150','PDT_150','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FB_250','BC_30','FRUIT_ROUGE'] },
  },
};

// Semaine 2 : rotation circulaire (LUNDI 2 = MARDI, etc.)
const ROTATION = {
  'LUNDI 2':    'MARDI',
  'MARDI 2':    'MERCREDI',
  'MERCREDI 2': 'JEUDI',
  'JEUDI 2':    'VENDREDI',
  'VENDREDI 2': 'SAMEDI',
  'SAMEDI 2':   'DIMANCHE',
  'DIMANCHE 2': 'LUNDI',
};

// Calcul des totaux
function calcDay(dayObj) {
  let tk=0,tc=0,tp=0,tf=0;
  for (const meal of Object.values(dayObj)) {
    for (const k of meal.items) {
      const [,,,kcal,c,p,fat] = F[k];
      tk+=kcal; tc+=c; tp+=p; tf+=fat;
    }
  }
  return { tk, tc, tp, tf };
}

console.log('\n=== Vérification programme YOHAN ===');
console.log('Cible : ~2200 kcal | P200 | C220 | L70  (±10%)\n');

const stats = {};
for (const day of Object.keys(DAYS)) {
  stats[day] = calcDay(DAYS[day]);
  const s = stats[day];
  const ok = (s.tk>=1980&&s.tk<=2420&&s.tp>=180&&s.tp<=220&&s.tc>=198&&s.tc<=242&&s.tf>=63&&s.tf<=77);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(10)} ${Math.round(s.tk)} kcal | P${Math.round(s.tp)} | C${Math.round(s.tc)} | L${Math.round(s.tf)}`);
}

console.log('\n=== Semaine 2 (rotation) ===');
for (const [newName, srcName] of Object.entries(ROTATION)) {
  const s = stats[srcName];
  const ok = (s.tk>=1980&&s.tk<=2420&&s.tp>=180&&s.tp<=220&&s.tc>=198&&s.tc<=242&&s.tf>=63&&s.tf<=77);
  console.log(`${ok?'OK':'XX'} ${newName.padEnd(12)} (=${srcName}) ${Math.round(s.tk)} kcal | P${Math.round(s.tp)} | C${Math.round(s.tc)} | L${Math.round(s.tf)}`);
}

const stats3y = {};
console.log('\n=== Semaine 3 ===');
for (const day of Object.keys(DAYS_W3_Y)) {
  stats3y[day] = calcDay(DAYS_W3_Y[day]);
  const s = stats3y[day];
  const ok = (s.tk>=1980&&s.tk<=2420&&s.tp>=180&&s.tp<=220&&s.tc>=198&&s.tc<=242&&s.tf>=63&&s.tf<=77);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(12)} ${Math.round(s.tk)} kcal | P${Math.round(s.tp)} | C${Math.round(s.tc)} | L${Math.round(s.tf)}`);
}

const stats4y = {};
console.log('\n=== Semaine 4 ===');
for (const day of Object.keys(DAYS_W4_Y)) {
  stats4y[day] = calcDay(DAYS_W4_Y[day]);
  const s = stats4y[day];
  const ok = (s.tk>=1980&&s.tk<=2420&&s.tp>=180&&s.tp<=220&&s.tc>=198&&s.tc<=242&&s.tf>=63&&s.tf<=77);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(12)} ${Math.round(s.tk)} kcal | P${Math.round(s.tp)} | C${Math.round(s.tc)} | L${Math.round(s.tf)}`);
}

// === Écriture Excel ===
const wb = XLSX.readFile(SRC);

// Supprimer toutes les feuilles de jours
const toRemove = wb.SheetNames.filter(n => n !== 'FICHE');
for (const n of toRemove) {
  wb.SheetNames.splice(wb.SheetNames.indexOf(n), 1);
  delete wb.Sheets[n];
}

const HEADER = ['JOUR','REPAS','HEURE','PRODUITS','QUANTITE','UNITE','CALORIE','GLUCIDE','PROTEINE','LIPIDE'];
const COLS = [{wch:10},{wch:14},{wch:10},{wch:24},{wch:9},{wch:6},{wch:9},{wch:9},{wch:10},{wch:9}];

function buildSheet(dayName, dayObj, dayStats) {
  const rows = [HEADER];
  let firstMeal = true;
  for (const [mealName, m] of Object.entries(dayObj)) {
    let firstItem = true;
    for (const k of m.items) {
      const [name,qty,unit,kcal,c,p,fat] = F[k];
      rows.push([
        firstItem && firstMeal ? dayName : '',
        firstItem ? mealName : '',
        firstItem ? m.time : '',
        name, qty, unit, kcal, c, p, fat,
      ]);
      firstItem = false; firstMeal = false;
    }
    rows.push([],[],[]);
  }
  const s = dayStats;
  rows.push(['TOTAL','','','','','',
    Math.round(s.tk*10)/10, Math.round(s.tc*100)/100,
    Math.round(s.tp*100)/100, Math.round(s.tf*100)/100]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = COLS;
  return ws;
}

// Semaine 1
for (const [dayName, dayObj] of Object.entries(DAYS)) {
  XLSX.utils.book_append_sheet(wb, buildSheet(dayName, dayObj, stats[dayName]), dayName);
}

// Semaine 2 (rotation)
for (const [newName, srcName] of Object.entries(ROTATION)) {
  const srcDay = DAYS[srcName];
  const newDay = {};
  for (const [mealName, m] of Object.entries(srcDay)) {
    newDay[mealName] = { time: m.time, items: [...m.items] };
  }
  XLSX.utils.book_append_sheet(wb, buildSheet(newName, newDay, stats[srcName]), newName);
}

// Semaine 3
for (const [dayName, dayObj] of Object.entries(DAYS_W3_Y)) {
  XLSX.utils.book_append_sheet(wb, buildSheet(dayName, dayObj, stats3y[dayName]), dayName);
}

// Semaine 4
for (const [dayName, dayObj] of Object.entries(DAYS_W4_Y)) {
  XLSX.utils.book_append_sheet(wb, buildSheet(dayName, dayObj, stats4y[dayName]), dayName);
}

XLSX.writeFile(wb, OUT);
console.log(`\nOK Fichier YOHAN sauvegardé : ${OUT}`);
console.log(`Feuilles : ${wb.SheetNames.join(', ')}`);
