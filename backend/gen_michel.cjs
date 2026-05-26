// Génère le programme nutritionnel de MICHEL (1m73, 33ans, 95kg)
// Cible : 1900 kcal | P 200g | C 140g | L 70g (sèche / définition)
const XLSX = require('xlsx');
const SRC = 'C:/Users/User/Downloads/PLAN NUTRITION MICHEL.xlsx';
const OUT = 'C:/Users/User/Downloads/PLAN NUTRITION MICHEL.xlsx';

// Portions corrigées (valeurs nutritionnelles fiables) : [nom, qty, unite, kcal, C, P, L]
const F = {
  // Corrections appliquées :
  //  - WHEY 30g : C 27.6 → 1.35 (anomalie : c'était probablement un swap C/P)
  //  - PETIT SUISSE 2u : L 16.87 → 8 (valeur réaliste pour 120g)
  WHEY:              ['WHEY',30,'G',119,1.35,27.6,0.5],         // CORRIGÉ
  WHEY_20:           ['WHEY',20,'G',79,0.9,18.4,0.33],
  BANANE_1U:         ['BANANE',1,'U',67.5,14.11,0.75,0.25],
  BANANE_100:        ['BANANE',100,'G',90,21,1,0.33],
  DATTES_20:         ['DATTES',20,'G',59.4,13.4,0.42,0],
  DATTES_40:         ['DATTES',40,'G',118.8,26.8,0.84,0],
  GALETTE:           ["GALETTE D'EPEAUTRE",1,'U',28.9,4.88,1.6,0.15],
  MIEL:              ['MIEL',10,'G',28.9,7.14,0,0],
  BLANC_POULET_100:  ['BLANC DE POULET',100,'G',106,0.6,21,2.2],
  BLANC_POULET_150:  ['BLANC DE POULET',150,'G',159,0.9,31.5,3.3],
  POULET_100:        ['POULET',100,'G',102,1.3,21,1.5],
  POULET_150:        ['POULET',150,'G',153,1.95,31.5,2.25],
  STEAK_1U:          ['STEAK',1,'U',153,0.61,12.16,11.4],
  STEAK_2U:          ['STEAK',2,'U',306,1.22,24.32,22.8],
  SARDINE_1U:        ['SARDINE',1,'BOITE',160.5,0,19.8,9.075],
  THON_1U:           ['THON',1,'BOITE',99,0,23,0.5],
  OEUF_1U:           ['OEUF',1,'U',73.7,0.29,7.43,4.74],
  OEUF_2U:           ['OEUF',2,'U',147.4,0.58,14.86,9.48],
  OEUFS_DURS_2U:     ['OEUFS DURS',2,'U',134,0.52,13.5,8.62],
  OEUFS_DURS_3U:     ['OEUFS DURS',3,'U',201,0.78,20.25,12.93],
  FROMAGE_BLANC_250: ['FROMAGE BLANC',250,'G',147.5,11.75,20,0],
  YAOURT_SPORT:      ['YAOURT SPORT',1,'U',113,5.9,20,0],
  PETIT_SUISSE_2U:   ['PETIT SUISSE',2,'U',140,7,8,8],            // CORRIGÉ
  CHIA:              ['GRAINE DE CHIA',5,'G',22.7,0.12,1.15,1.55],
  BEURRE_CACAH_20:   ['BEURRE DE CACAHOUETE',20,'G',125.8,2.6,5.2,10.2],
  HUILE_5:           ["HUILE D'OLIVE",5,'G',41.1,0,0,4.55],
  HUILE_10:          ["HUILE D'OLIVE",10,'G',82.2,0,0,9.1],
  KIWI_100:          ['KIWI',1,'U',48,11.3,0,0],
  POMME_1U:          ['POMME',1,'U',52,13.8,0.3,0.2],
  FRUIT_ROUGE:       ['FRUIT ROUGE',100,'G',49,8.7,0.9,0],
  HARICOT_VERT_200:  ['HARICOT VERT',200,'G',81.8,16.48,2.36,0],
  HARICOT_VERT_300:  ['HARICOT VERT',300,'G',122.7,24.72,3.54,0],
  BROCOLI_200:       ['BROCOLI',200,'G',70,14.25,4.74,0.82],
  MACHE_ROQUETTE_100:['MACHE ROQUETTE',100,'G',21,1.3,2.3,0],
  MACHE_ROQUETTE_200:['MACHE ROQUETTE',200,'G',42,2.6,4.6,0],
  PATATE_DOUCE_100:  ['PATATE DOUCE',100,'G',62.8,12.2,1.69,0.15],
  PATATE_DOUCE_150:  ['PATATE DOUCE',150,'G',94.2,18.3,2.55,0.15],
  POMME_DE_TERRE_100:['POMME DE TERRE',100,'G',74,15.8,2,0.2],
  RIZ_50:            ['RIZ',50,'G',57.5,12.5,1.5,0.15],
  RIZ_80:            ['RIZ',80,'G',92,20,2.4,0.24],
  LENTILLE_50:       ['LENTILLE',50,'G',51.5,6.1,4.3,0.2],
  LENTILLE_100:      ['LENTILLE',100,'G',103,12.2,8.6,0.4],
  LENTILLE_150:      ['LENTILLE',150,'G',154.5,18.3,12.9,0.6],
  RIZ_100:           ['RIZ',100,'G',115,25,3,0.3],
  RIZ_150:           ['RIZ',150,'G',172.5,37.5,4.5,0.45],
  HARICOT_ROUGE_100: ['HARICOT ROUGE',100,'G',127,22,8.7,0.5],
  HARICOT_ROUGE_150: ['HARICOT ROUGE',150,'G',190.5,33,13.05,0.75],
};

// 7 jours Michel — cible ~1900 kcal | P200 | C140 | L70
const DAYS = {
  LUNDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY','BLANC_POULET_100','BANANE_1U','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_10','POULET_150','PATATE_DOUCE_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['POMME_1U','OEUFS_DURS_2U','YAOURT_SPORT'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_100','HUILE_10','BLANC_POULET_150','PATATE_DOUCE_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U','CHIA','BEURRE_CACAH_20'] },
  },
  MARDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','GALETTE','BEURRE_CACAH_20','FRUIT_ROUGE'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_5','POULET_150','RIZ_50','OEUF_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['POMME_1U','OEUFS_DURS_2U','BEURRE_CACAH_20'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','HUILE_10','BLANC_POULET_150','PATATE_DOUCE_100'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U','CHIA'] },
  },
  MERCREDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_10','STEAK_1U','POMME_DE_TERRE_100','YAOURT_SPORT'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','WHEY_20','POMME_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_200','BLANC_POULET_150','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  JEUDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_50','HARICOT_VERT_200','STEAK_1U','OEUF_1U','YAOURT_SPORT'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','BANANE_1U','WHEY_20'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_300','THON_1U','HUILE_10','BEURRE_CACAH_20'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U'] },
  },
  VENDREDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_10','POULET_150','PATATE_DOUCE_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['POMME_1U','OEUFS_DURS_3U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_200','SARDINE_1U','SARDINE_1U','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U','CHIA','BEURRE_CACAH_20'] },
  },
  SAMEDI: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','BLANC_POULET_100','WHEY','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BANANE_1U','BEURRE_CACAH_20'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['POMME_DE_TERRE_100','POULET_150','BROCOLI_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['POMME_1U','OEUFS_DURS_2U','YAOURT_SPORT'] },
    'DINNER':      { time: '19H - 21H',items: ['PATATE_DOUCE_100','MACHE_ROQUETTE_100','THON_1U','OEUF_1U','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','WHEY_20','BEURRE_CACAH_20'] },
  },
  DIMANCHE: {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','GALETTE','BEURRE_CACAH_20','BANANE_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_5','POULET_150','RIZ_50','OEUF_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['PETIT_SUISSE_2U','OEUF_1U','POMME_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_200','POULET_150','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','FRUIT_ROUGE','BEURRE_CACAH_20'] },
  },
};

// 7 jours — Semaine 2 (riz, lentilles, haricots rouges introduits)
const DAYS_W2 = {
  'LUNDI 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY','BLANC_POULET_100','BANANE_1U','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_10','POULET_100','RIZ_80'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','POMME_1U','WHEY_20'] },
    'DINNER':      { time: '19H - 21H',items: ['LENTILLE_100','BLANC_POULET_150','MACHE_ROQUETTE_100','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'MARDI 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','HUILE_5','CHIA'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','GALETTE','BEURRE_CACAH_20','FRUIT_ROUGE'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_ROUGE_100','POULET_150','OEUF_1U','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','POMME_1U','BEURRE_CACAH_20'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','BLANC_POULET_150','RIZ_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','CHIA'] },
  },
  'MERCREDI 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','STEAK_1U','MACHE_ROQUETTE_100','RIZ_50','HUILE_10'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','WHEY_20','POMME_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_200','BLANC_POULET_150','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'JEUDI 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_ROUGE_100','HARICOT_VERT_200','STEAK_1U','OEUF_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','BANANE_1U','WHEY_20'] },
    'DINNER':      { time: '19H - 21H',items: ['LENTILLE_50','HARICOT_VERT_200','THON_1U','HUILE_10','BEURRE_CACAH_20'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U'] },
  },
  'VENDREDI 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['RIZ_80','POULET_150','HARICOT_VERT_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['WHEY_20','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_ROUGE_100','SARDINE_1U','MACHE_ROQUETTE_100','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U','CHIA','BEURRE_CACAH_20'] },
  },
  'SAMEDI 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','BLANC_POULET_100','WHEY','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BANANE_1U','BEURRE_CACAH_20'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['RIZ_80','POULET_150','BROCOLI_200','HUILE_10'] },
    'COLLATION 2': { time: '14H-17H',  items: ['POMME_1U','OEUFS_DURS_2U','YAOURT_SPORT'] },
    'DINNER':      { time: '19H - 21H',items: ['LENTILLE_100','THON_1U','MACHE_ROQUETTE_100','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','CHIA'] },
  },
  'DIMANCHE 2': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','BANANE_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_ROUGE_100','POULET_150','HARICOT_VERT_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['PETIT_SUISSE_2U','OEUF_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['LENTILLE_50','BLANC_POULET_150','HARICOT_VERT_200','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','FRUIT_ROUGE','BEURRE_CACAH_20'] },
  },
};

// Semaine 3 — sardine/thon au déjeuner, riz le soir, lentilles/haricots rouges en féculents
const DAYS_W3 = {
  'LUNDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['STEAK_1U','DATTES_20','WHEY','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['SARDINE_1U','HARICOT_ROUGE_100','HARICOT_VERT_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_SPORT','POMME_1U','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_100','BLANC_POULET_150','RIZ_80','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'MARDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY_20','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','HARICOT_VERT_200','STEAK_1U','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','BANANE_1U','YAOURT_SPORT'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','BLANC_POULET_150','RIZ_50','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U','BEURRE_CACAH_20'] },
  },
  'MERCREDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','POMME_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['THON_1U','HARICOT_VERT_200','LENTILLE_50','OEUF_1U','HUILE_10'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_SPORT','KIWI_100','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_200','BLANC_POULET_150','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'JEUDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['WHEY_20','BLANC_POULET_100','DATTES_20','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['SARDINE_1U','SARDINE_1U','HARICOT_VERT_200','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_2U','POMME_1U','BEURRE_CACAH_20'] },
    'DINNER':      { time: '19H - 21H',items: ['LENTILLE_100','BLANC_POULET_150','HARICOT_VERT_200','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','CHIA'] },
  },
  'VENDREDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['SARDINE_1U','LENTILLE_100','HARICOT_VERT_200','HUILE_10'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_SPORT','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_200','POULET_150','RIZ_80','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','POMME_1U','BEURRE_CACAH_20'] },
  },
  'SAMEDI 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','BLANC_POULET_100','WHEY','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','BANANE_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['SARDINE_1U','LENTILLE_100','BROCOLI_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_SPORT','POMME_1U','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_200','BLANC_POULET_150','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20'] },
  },
  'DIMANCHE 3': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','GALETTE','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['THON_1U','HARICOT_VERT_200','HARICOT_ROUGE_100','HUILE_10'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','KIWI_100','BEURRE_CACAH_20'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_200','POULET_150','RIZ_80','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
};

// Semaine 4 — galettes & petit suisse au petit déj, steak & oeufs en milieu de journée
const DAYS_W4 = {
  'LUNDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['PETIT_SUISSE_2U','WHEY','GALETTE','GALETTE','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','POMME_1U'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_10','POULET_150','PATATE_DOUCE_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['THON_1U','KIWI_100','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','BLANC_POULET_150','RIZ_50','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'MARDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_40','WHEY','BLANC_POULET_100','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','GALETTE','BEURRE_CACAH_20','FRUIT_ROUGE'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_ROUGE_100','HARICOT_VERT_200','STEAK_1U'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_SPORT','OEUFS_DURS_2U','BANANE_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_100','BLANC_POULET_150','PATATE_DOUCE_100','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'MERCREDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','GALETTE','GALETTE','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['LENTILLE_100','HARICOT_VERT_200','POULET_100','OEUF_1U','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['BLANC_POULET_100','POMME_1U','BEURRE_CACAH_20','CHIA'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_VERT_200','BLANC_POULET_150','PATATE_DOUCE_150','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'JEUDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['PETIT_SUISSE_2U','WHEY','DATTES_20','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','KIWI_100'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['BROCOLI_200','BLANC_POULET_150','RIZ_50','OEUF_1U','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUFS_DURS_2U','POMME_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['HARICOT_ROUGE_100','POULET_150','MACHE_ROQUETTE_100','HUILE_10'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20'] },
  },
  'VENDREDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','WHEY','BLANC_POULET_100','GALETTE','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','CHIA','BEURRE_CACAH_20','FRUIT_ROUGE'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_10','POULET_150','PATATE_DOUCE_100'] },
    'COLLATION 2': { time: '14H-17H',  items: ['OEUF_1U','POMME_1U','OEUFS_DURS_2U'] },
    'DINNER':      { time: '19H - 21H',items: ['LENTILLE_100','BLANC_POULET_150','HARICOT_VERT_200','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','CHIA'] },
  },
  'SAMEDI 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['BANANE_1U','WHEY','GALETTE','GALETTE','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','KIWI_100','HUILE_5'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_ROUGE_150','POULET_150','HARICOT_VERT_200','HUILE_5'] },
    'COLLATION 2': { time: '14H-17H',  items: ['YAOURT_SPORT','OEUFS_DURS_2U','POMME_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['BROCOLI_200','SARDINE_1U','MACHE_ROQUETTE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','CHIA'] },
  },
  'DIMANCHE 4': {
    'PETIT DEJ':   { time: '5H - 8H',  items: ['DATTES_20','BLANC_POULET_100','WHEY_20','HUILE_5'] },
    'COLLATION 1': { time: '9H - 12H', items: ['FROMAGE_BLANC_250','BEURRE_CACAH_20','KIWI_100','CHIA'] },
    'DEJEUNER':    { time: '12H-14H',  items: ['HARICOT_VERT_200','HUILE_5','BLANC_POULET_150','RIZ_80'] },
    'COLLATION 2': { time: '14H-17H',  items: ['PETIT_SUISSE_2U','OEUF_2U','POMME_1U'] },
    'DINNER':      { time: '19H - 21H',items: ['MACHE_ROQUETTE_200','POULET_150','PATATE_DOUCE_100','HUILE_5'] },
    'COLLATION 3': { time: '21H - 22H',items: ['FROMAGE_BLANC_250','FRUIT_ROUGE','BEURRE_CACAH_20'] },
  },
};

// Vérification des totaux
console.log('\n=== Vérification programme MICHEL ===');
console.log('Cible : 1900 kcal | P200 | C140 | L70\n');
const stats = {};
for (const day of Object.keys(DAYS)) {
  let tk=0,tp=0,tc=0,tf=0;
  for (const meal of Object.keys(DAYS[day])) {
    for (const k of DAYS[day][meal].items) {
      const [,,,kcal,c,p,fat] = F[k];
      tk+=kcal; tc+=c; tp+=p; tf+=fat;
    }
  }
  stats[day] = { tk, tp, tc, tf };
  const ok = (tk>=1780&&tk<=2020&&tp>=185&&tp<=215&&tc>=125&&tc<=155&&tf>=60&&tf<=80);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(10)} ${Math.round(tk)} kcal | P${Math.round(tp)} | C${Math.round(tc)} | L${Math.round(tf)}`);
}

const stats2 = {};
console.log('\n=== Semaine 2 ===');
for (const day of Object.keys(DAYS_W2)) {
  let tk=0,tp=0,tc=0,tf=0;
  for (const meal of Object.keys(DAYS_W2[day])) {
    for (const k of DAYS_W2[day][meal].items) {
      const [,,,kcal,c,p,fat] = F[k];
      tk+=kcal; tc+=c; tp+=p; tf+=fat;
    }
  }
  stats2[day] = { tk, tp, tc, tf };
  const ok = (tk>=1780&&tk<=2020&&tp>=185&&tp<=215&&tc>=125&&tc<=155&&tf>=60&&tf<=80);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(12)} ${Math.round(tk)} kcal | P${Math.round(tp)} | C${Math.round(tc)} | L${Math.round(tf)}`);
}

const stats3 = {};
console.log('\n=== Semaine 3 ===');
for (const day of Object.keys(DAYS_W3)) {
  let tk=0,tp=0,tc=0,tf=0;
  for (const meal of Object.keys(DAYS_W3[day])) {
    for (const k of DAYS_W3[day][meal].items) {
      const [,,,kcal,c,p,fat] = F[k];
      tk+=kcal; tc+=c; tp+=p; tf+=fat;
    }
  }
  stats3[day] = { tk, tp, tc, tf };
  const ok = (tk>=1780&&tk<=2020&&tp>=185&&tp<=215&&tc>=125&&tc<=155&&tf>=60&&tf<=80);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(12)} ${Math.round(tk)} kcal | P${Math.round(tp)} | C${Math.round(tc)} | L${Math.round(tf)}`);
}

const stats4 = {};
console.log('\n=== Semaine 4 ===');
for (const day of Object.keys(DAYS_W4)) {
  let tk=0,tp=0,tc=0,tf=0;
  for (const meal of Object.keys(DAYS_W4[day])) {
    for (const k of DAYS_W4[day][meal].items) {
      const [,,,kcal,c,p,fat] = F[k];
      tk+=kcal; tc+=c; tp+=p; tf+=fat;
    }
  }
  stats4[day] = { tk, tp, tc, tf };
  const ok = (tk>=1780&&tk<=2020&&tp>=185&&tp<=215&&tc>=125&&tc<=155&&tf>=60&&tf<=80);
  console.log(`${ok?'OK':'XX'} ${day.padEnd(12)} ${Math.round(tk)} kcal | P${Math.round(tp)} | C${Math.round(tc)} | L${Math.round(tf)}`);
}

// === Écriture dans Excel ===
const wb = XLSX.readFile(SRC);

// Mettre à jour la FICHE avec les cibles de Michel
if (wb.Sheets['FICHE']) {
  const fr = XLSX.utils.sheet_to_json(wb.Sheets['FICHE'], { header: 1, defval: '' });
  for (let i = 0; i < fr.length; i++) {
    if (fr[i] && fr[i][0]) {
      const k = String(fr[i][0]).toUpperCase().trim();
      if (k === 'KCAL')     fr[i][1] = 1900;
      if (k === 'PROTEINE') fr[i][1] = 200;
      if (k === 'GLUCIDE')  fr[i][1] = 140;
      if (k === 'LIPIDE')   fr[i][1] = 70;
    }
  }
  wb.Sheets['FICHE'] = XLSX.utils.aoa_to_sheet(fr);
}

// Supprimer toutes les anciennes feuilles de jours (originaux + X 2)
const toRemove = [...wb.SheetNames].filter(n => n !== 'FICHE');
for (const n of toRemove) {
  wb.SheetNames.splice(wb.SheetNames.indexOf(n), 1);
  delete wb.Sheets[n];
}

const HEADER = ['JOUR','REPAS','HEURE','PRODUITS','QUANTITE','UNITE','CALORIE','GLUCIDE','PROTEINE','LIPIDE'];

for (const dayName of Object.keys(DAYS)) {
  const rows = [HEADER];
  let firstMeal = true;
  for (const mealName of Object.keys(DAYS[dayName])) {
    const m = DAYS[dayName][mealName];
    let firstItem = true;
    for (const k of m.items) {
      const [name,qty,unit,kcal,c,p,fat] = F[k];
      rows.push([
        firstItem && firstMeal ? dayName : '',
        firstItem ? mealName : '',
        firstItem ? m.time : '',
        name, qty, unit, kcal, c, p, fat,
      ]);
      firstItem = false;
      firstMeal = false;
    }
    rows.push([],[],[]);
  }
  // Ligne TOTAL
  const s = stats[dayName];
  rows.push(['TOTAL','','','','','', Math.round(s.tk*10)/10, Math.round(s.tc*100)/100, Math.round(s.tp*100)/100, Math.round(s.tf*100)/100]);

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  newSheet['!cols'] = [
    {wch:10},{wch:14},{wch:10},{wch:24},{wch:9},{wch:6},{wch:9},{wch:9},{wch:10},{wch:9},
  ];
  XLSX.utils.book_append_sheet(wb, newSheet, dayName);
}

// Semaine 2
for (const dayName of Object.keys(DAYS_W2)) {
  // Supprimer si déjà présente
  if (wb.SheetNames.includes(dayName)) {
    wb.SheetNames.splice(wb.SheetNames.indexOf(dayName), 1);
    delete wb.Sheets[dayName];
  }
  const rows = [HEADER];
  let firstMeal = true;
  for (const mealName of Object.keys(DAYS_W2[dayName])) {
    const m = DAYS_W2[dayName][mealName];
    let firstItem = true;
    for (const k of m.items) {
      const [name,qty,unit,kcal,c,p,fat] = F[k];
      rows.push([
        firstItem && firstMeal ? dayName : '',
        firstItem ? mealName : '',
        firstItem ? m.time : '',
        name, qty, unit, kcal, c, p, fat,
      ]);
      firstItem = false;
      firstMeal = false;
    }
    rows.push([],[],[]);
  }
  const s = stats2[dayName];
  rows.push(['TOTAL','','','','','', Math.round(s.tk*10)/10, Math.round(s.tc*100)/100, Math.round(s.tp*100)/100, Math.round(s.tf*100)/100]);

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  newSheet['!cols'] = [
    {wch:10},{wch:14},{wch:10},{wch:24},{wch:9},{wch:6},{wch:9},{wch:9},{wch:10},{wch:9},
  ];
  XLSX.utils.book_append_sheet(wb, newSheet, dayName);
}

// Semaine 3
for (const dayName of Object.keys(DAYS_W3)) {
  if (wb.SheetNames.includes(dayName)) {
    wb.SheetNames.splice(wb.SheetNames.indexOf(dayName), 1);
    delete wb.Sheets[dayName];
  }
  const rows = [HEADER];
  let firstMeal = true;
  for (const mealName of Object.keys(DAYS_W3[dayName])) {
    const m = DAYS_W3[dayName][mealName];
    let firstItem = true;
    for (const k of m.items) {
      const [name,qty,unit,kcal,c,p,fat] = F[k];
      rows.push([
        firstItem && firstMeal ? dayName : '',
        firstItem ? mealName : '',
        firstItem ? m.time : '',
        name, qty, unit, kcal, c, p, fat,
      ]);
      firstItem = false;
      firstMeal = false;
    }
    rows.push([],[],[]);
  }
  const s = stats3[dayName];
  rows.push(['TOTAL','','','','','', Math.round(s.tk*10)/10, Math.round(s.tc*100)/100, Math.round(s.tp*100)/100, Math.round(s.tf*100)/100]);

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  newSheet['!cols'] = [
    {wch:10},{wch:14},{wch:10},{wch:24},{wch:9},{wch:6},{wch:9},{wch:9},{wch:10},{wch:9},
  ];
  XLSX.utils.book_append_sheet(wb, newSheet, dayName);
}

// Semaine 4
for (const dayName of Object.keys(DAYS_W4)) {
  if (wb.SheetNames.includes(dayName)) {
    wb.SheetNames.splice(wb.SheetNames.indexOf(dayName), 1);
    delete wb.Sheets[dayName];
  }
  const rows = [HEADER];
  let firstMeal = true;
  for (const mealName of Object.keys(DAYS_W4[dayName])) {
    const m = DAYS_W4[dayName][mealName];
    let firstItem = true;
    for (const k of m.items) {
      const [name,qty,unit,kcal,c,p,fat] = F[k];
      rows.push([
        firstItem && firstMeal ? dayName : '',
        firstItem ? mealName : '',
        firstItem ? m.time : '',
        name, qty, unit, kcal, c, p, fat,
      ]);
      firstItem = false;
      firstMeal = false;
    }
    rows.push([],[],[]);
  }
  const s = stats4[dayName];
  rows.push(['TOTAL','','','','','', Math.round(s.tk*10)/10, Math.round(s.tc*100)/100, Math.round(s.tp*100)/100, Math.round(s.tf*100)/100]);

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  newSheet['!cols'] = [
    {wch:10},{wch:14},{wch:10},{wch:24},{wch:9},{wch:6},{wch:9},{wch:9},{wch:10},{wch:9},
  ];
  XLSX.utils.book_append_sheet(wb, newSheet, dayName);
}

XLSX.writeFile(wb, OUT);
console.log(`\nOK Fichier MICHEL sauvegardé : ${OUT}`);
console.log(`Feuilles : ${wb.SheetNames.join(', ')}`);
