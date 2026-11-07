// Le récap de séance est relié à ce que l'élève a rempli dans « Mon profil coaching » :
// lignes « Pour toi » (réaction au succès / à une séance en dessous, moteurs, exercices préféré / détesté),
// et limites explicites respectées (physique, comparaison, blagues, culpabilisation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, a); return html.slice(i, j); };
const SRC = slice('function normExerciseName', '// Clé de comparaison de NOMS DE SÉANCE') + '\n'
  + slice('const CONGRATS_MESSAGES', 'function computeGoalsCtx') + '\n'
  + slice('function computeCoachCtx', 'function RecapPersonal') + '\n'
  + slice('// Hash déterministe', 'function sessionVolumeOf') + '\n'
  + [slice('const DELOAD_MINDSET', '];\n') + '];', slice('const POST_DELOAD_MINDSET', '];\n') + '];', slice('const MENSTRUAL_MINDSET', '];\n') + '];'].join('\n');
const L = new Function('gg', SRC + '\nreturn { mindsetPoolFor, coachPreSessionMessage, STYLE_MINDSET, MIND_PERSEVERE, MIND_ESPRIT, MIND_PERF, MIND_SIGNAUX, MIND_MAX, MINDSET_INTENSE, biasMindsetPool, athleteRegressionText, computeCoachCtx, recapPersonalLines, recapPoolFor, congratsMessage, motivationQuote, MOTIVATION_ELITE, MOTIVATION_GOOD, MINDSET_HARSH };')((g, a, b) => b);

const ctx = p => L.computeCoachCtx(p);
const sess = (...names) => ({ exercises: names.map(n => ({ name: n, sets: [{ weight: 50, reps: 10 }] })) });
const goodComp = { prsCount: 1, upCount: 3, downCount: 0, sameCount: 0, totalExercises: 3,
  exercises: [{ name: 'Squat', status: 'up', isPR: true }, { name: 'Tirage', status: 'up' }, { name: 'Curl', status: 'up' }] };
const badComp = { prsCount: 0, upCount: 0, downCount: 3, sameCount: 0, totalExercises: 3,
  exercises: [{ name: 'Squat', status: 'down' }, { name: 'Tirage', status: 'down' }, { name: 'Curl', status: 'down' }] };
const volUp = { previous: 8000, current: 9000 };
const volDown = { previous: 9000, current: 7000 };
const lines = (profile, o) => L.recapPersonalLines({ coach: ctx(profile), seed: 's1', name: 'Laura', session: sess('Squat'), ...o });

test('profil vide ou absent : aucune ligne « Pour toi »', () => {
  assert.deepEqual(lines({}, { comp: goodComp, volumeVsPrev: volUp }), []);
  assert.deepEqual(L.recapPersonalLines({ coach: null, comp: goodComp }), []);
});

test('une seule ligne, factuelle : la préférence « quand tu réussis » choisit laquelle', () => {
  const ok = (p, re) => { const l = lines(p, { comp: goodComp, volumeVsPrev: volUp }); assert.equal(l.length, 1); assert.match(l[0], re); };
  ok({ cpSuccessReaction: ['Une statistique'] }, /\+13 % de volume.*9[\s\u202f\u00a0]?000 kg/);
  ok({ cpSuccessReaction: ['Un nouveau défi'] }, /défi.*Squat.*une rep de plus/i);
  // pas de morale ni de félicitation répétée : ces préférences n'ajoutent plus de ligne
  for (const p of [{ cpSuccessReaction: ['Une grosse félicitation'] }, { cpSuccessReaction: ['Un message simple'] }, { cpDrives: ['Être fier de moi', 'Ne pas abandonner', 'Battre mon record'] }])
    assert.deepEqual(lines(p, { comp: goodComp, volumeVsPrev: volUp }), []);
  // plusieurs préférences → toujours UNE seule ligne
  assert.equal(lines({ cpSuccessReaction: ['Une statistique', 'Un nouveau défi', 'Une petite vanne'], cpCatchphrase: 'Allez' }, { comp: goodComp, volumeVsPrev: volUp }).length, 1);
});

test('séance en dessous : défi seulement si ni « culpabilisant » ni « trop agressif » ; « relativiser » n\'ajoute pas de ligne', () => {
  assert.match(lines({ cpMissedReaction: ['Me challenger'] }, { comp: badComp })[0], /Squat/);
  assert.deepEqual(lines({ cpMissedReaction: ['Me challenger'], cpDontDo: ['Culpabilisant'] }, { comp: badComp }), []);
  assert.deepEqual(lines({ cpMissedReaction: ['Me challenger'], cpDontDo: ['Trop agressif'] }, { comp: badComp }), []);
  assert.deepEqual(lines({ cpMissedReaction: ['Relativiser', 'Me remettre au travail'] }, { comp: badComp, volumeVsPrev: volDown }), []);
  assert.deepEqual(lines({ cpSuccessReaction: ['Une statistique'] }, { comp: badComp, volumeVsPrev: volDown }), []);
  assert.deepEqual(lines({ cpMissedReaction: ['Me challenger'] }, { comp: goodComp, volumeVsPrev: volUp }), []);
});

test('rappel d\'objectif seulement si la fiche objectifs est remplie', () => {
  const p = { cpMissedReaction: ['Rappeler mon objectif'] };
  assert.deepEqual(lines(p, { comp: badComp }), []);
  assert.match(lines(p, { comp: badComp, goals: { objective: 'prise de masse' } })[0], /ta prise de masse/);
});

test('vanne : expression fétiche seulement si l\'humour est permis', () => {
  const p = { cpSuccessReaction: ['Une petite vanne'], cpCatchphrase: 'Ça passe ou ça casse' };
  assert.match(lines(p, { comp: goodComp })[0], /Ça passe ou ça casse/);
  assert.deepEqual(lines({ ...p, cpDontDo: ['Trop familier'] }, { comp: goodComp }), []);
  assert.deepEqual(lines({ ...p, cpBanterLevel: 1 }, { comp: goodComp }), []);
});

test('exercice préféré / détesté : seulement s\'il est dans la séance, et jamais « plaisir » s\'il a reculé', () => {
  assert.match(lines({ cpFavExercise: 'squat' }, { comp: goodComp, session: sess('Squat barre') })[0], /Squat barre, ton exercice préféré/);
  assert.match(lines({ cpHatedExercise: 'Burpees' }, { comp: goodComp, session: sess('Burpees', 'Squat') })[0], /Au programme aujourd'hui : Burpees\. Et tu l'as fait quand même/);
  assert.deepEqual(lines({ cpFavExercise: 'Soulevé de terre' }, { comp: goodComp, session: sess('Squat') }), []);
  assert.deepEqual(lines({ cpFavExercise: 'Squat' }, { comp: badComp, volumeVsPrev: volDown, session: sess('Squat') }), []);
  const mixed = { prsCount: 0, upCount: 2, downCount: 1, sameCount: 0, totalExercises: 3, exercises: [{ name: 'Squat', status: 'down' }, { name: 'Tirage', status: 'up' }, { name: 'Curl', status: 'up' }] };
  assert.deepEqual(lines({ cpFavExercise: 'Squat' }, { comp: mixed, volumeVsPrev: volUp, session: sess('Squat', 'Tirage') }), []);
  // la ligne factuelle prime sur l'exercice préféré (une seule ligne)
  assert.match(lines({ cpFavExercise: 'Squat', cpSuccessReaction: ['Une statistique'] }, { comp: goodComp, volumeVsPrev: volUp, session: sess('Squat') })[0], /En chiffres/);
});

test('les préférences orientent la phrase de Mindset (sans doublon, sans nouvelle phrase)', () => {
  const pool = ['A fier de toi.', 'B constance.', 'C autre.'];
  assert.deepEqual(L.biasMindsetPool(pool, ctx({ cpDrives: ['Être fier de moi'] }), 'good'), ['A fier de toi.']);
  assert.deepEqual(L.biasMindsetPool(pool, ctx({ cpDrives: ['Ne pas abandonner'] }), 'elite'), ['B constance.']);
  assert.equal(L.biasMindsetPool(pool, ctx({ cpDrives: ['Être fier de moi'] }), 'hard'), pool, 'pas de « fierté » sur une séance en dessous');
  assert.equal(L.biasMindsetPool(pool, ctx({ cpNickname: 'x' }), 'good'), pool, 'sans préférence : inchangé');
  assert.equal(L.biasMindsetPool(['X', 'Y'], ctx({ cpDrives: ['Être fier de moi'] }), 'good').length, 2, 'aucune phrase correspondante : inchangé');
  assert.ok(L.biasMindsetPool(['Pas de reproche : on regarde devant.', 'Autre chose.'], ctx({ cpMissedReaction: ['Relativiser'] }), 'hard').length === 1);
  // réel : un élève qui dit être motivé par la fierté voit une phrase de fierté sur une belle séance
  let fier = 0;
  for (let i = 0; i < 30; i++) if (/fier/i.test(L.motivationQuote(goodComp, volUp, 'q' + i, false, false, null, '', ctx({ cpDrives: ['Être fier de moi'] })))) fier++;
  assert.ok(fier > 0, 'au moins une séance sur 30 tombe sur une phrase de fierté');
});

test('décharge / reprise : aucune ligne', () => {
  const p = { cpSuccessReaction: ['Une statistique'] };
  assert.deepEqual(lines(p, { comp: goodComp, volumeVsPrev: volUp, isDeload: true }), []);
  assert.deepEqual(lines(p, { comp: goodComp, volumeVsPrev: volUp, isPostDeload: true }), []);
});

test('même séance → même ligne (pas de phrase qui bouge au rendu)', () => {
  const p = { cpSuccessReaction: ['Une statistique', 'Un nouveau défi'], cpDrives: ['Être fier de moi'] };
  assert.deepEqual(lines(p, { comp: goodComp, volumeVsPrev: volUp }), lines(p, { comp: goodComp, volumeVsPrev: volUp }));
  assert.ok(lines(p, { comp: goodComp, volumeVsPrev: volUp }).length <= 2);
});

test('mindset : « physique » et « comparaison » retirés des phrases quand l\'élève l\'interdit', () => {
  const pool = L.recapPoolFor(L.MOTIVATION_ELITE, ctx({ cpDontDo: ['Commenter mon physique', 'Me comparer aux autres'] }));
  assert.ok(pool.length > 0 && pool.length < L.MOTIVATION_ELITE.length);
  for (const t of pool) { assert.doesNotMatch(t, /physique|miroir/i); assert.doesNotMatch(t, /\bgens\b|ceux qui|ordinaires/i); }
  assert.equal(L.recapPoolFor(L.MOTIVATION_ELITE, ctx({ cpNickname: 'Lau' })), L.MOTIVATION_ELITE, 'sans limite : pool inchangé');
  for (let i = 0; i < 40; i++) {
    const q = L.motivationQuote(null, { previous: 9000, current: 5000 }, 'x' + i, false, false, null, '', ctx({ cpDontDo: ['Commenter mon physique', 'Me comparer aux autres'], cpBanterLevel: 5 }));
    assert.doesNotMatch(q, /physique|miroir/i);
    assert.doesNotMatch(q, /\bgens\b|ceux qui|spectateur/i);
  }
});

test('message de récap : pas de blague (😏 😉 😅) si « trop familier » / jamais chambrer', () => {
  const noJoke = ctx({ cpDontDo: ['Trop familier'] });
  const mixed = { prsCount: 0, upCount: 1, downCount: 1, sameCount: 2, totalExercises: 4, exercises: [] };
  const mixedUp = { prsCount: 0, upCount: 2, downCount: 1, sameCount: 2, totalExercises: 5, exercises: [] };
  const out = [
    L.congratsMessage('Laura', null, mixed, { coach: noJoke, seed: 'a' }),
    L.congratsMessage('Laura', null, mixedUp, { coach: noJoke, seed: 'a' }),
  ];
  for (let i = 0; i < 20; i++) out.push(L.congratsMessage('Laura', { previous: 9000, current: 8500 }, null, { coach: ctx({ cpDontDo: ['Culpabilisant'], cpBanterLevel: 1 }), seed: 'b' + i }));
  for (const m of out) assert.doesNotMatch(m, /😏|😉|😅/, m);
  assert.match(L.congratsMessage('Laura', null, mixed, { coach: null, seed: 'a' }), /😏/, 'sans limite, la vanne reste');
  assert.match(L.congratsMessage('Laura', null, mixedUp, { coach: null, seed: 'a' }), /😉/, 'sans limite, la vanne reste');
});

test('bandeau « séance en baisse » de l\'athlète : doux si « culpabilisant » / « trop agressif » / chambrage faible', () => {
  for (const hist of [false, true]) {
    for (const p of [{ cpDontDo: ['Culpabilisant'] }, { cpDontDo: ['Trop agressif'] }, { cpBanterLevel: 1 }]) {
      const t = L.athleteRegressionText(ctx(p), 2, hist);
      assert.match(t, /Pas de reproche/);
      assert.doesNotMatch(t, /se reprendre|tu donnes tout|remets ça à l'endroit/);
      assert.match(t, /2 exercices/);
    }
    assert.doesNotMatch(L.athleteRegressionText(ctx({ cpBanterLevel: 4 }), 2, hist), /Pas de reproche/);
    assert.doesNotMatch(L.athleteRegressionText(null, 0, hist), /Pas de reproche/);
  }
  assert.match(L.athleteRegressionText(null, 2, false), /tu donnes tout/);
});

test('les trois récaps (athlète, historique, coach) affichent la ligne dans la carte Mindset', () => {
  assert.equal((html.match(/<RecapPersonal /g) || []).length, 3);
  assert.equal((html.match(/recapPersonalLines\(\{/g) || []).length >= 3, true);
});

// ── Phrases « mentalité de performance » du coach, réparties selon le profil et la performance ────────────────
const NEW5 = () => [L.MIND_PERSEVERE, L.MIND_ESPRIT, L.MIND_PERF, L.MIND_SIGNAUX, L.MIND_MAX];
const CATS = ['hard', 'pique', 'elite', 'good', 'mixed', 'neutral', 'first'];
const textOf = x => (typeof x === 'function' ? x('') : x);
const neutralComp = { prsCount: 0, upCount: 0, downCount: 0, sameCount: 3, totalExercises: 3, exercises: [] };

test('phrases de perf : exactes (texte du coach) et présentes dans les pools prévus', () => {
  assert.equal(L.MIND_PERSEVERE, "Tu te dois de voir jusqu'où tu peux aller si tu n'abandonnes pas.");
  assert.equal(L.MIND_MAX, "Ton maximum, c'est le minimum de quelqu'un d'autre. Travaille plus dur.");
  const pool = (cat, p) => L.mindsetPoolFor(cat, p === undefined ? null : ctx(p)).map(textOf);
  assert.ok(pool('elite').includes(L.MIND_MAX));
  assert.ok(pool('good').includes(L.MIND_PERSEVERE));
  assert.ok(pool('pique').includes(L.MIND_ESPRIT) && pool('pique').includes(L.MIND_PERF));
  assert.ok(pool('hard').includes(L.MIND_ESPRIT));
  assert.ok(pool('neutral').includes(L.MIND_PERF) && pool('neutral').includes(L.MIND_SIGNAUX));
  assert.ok(pool('first').includes(L.MIND_SIGNAUX));
  // une baisse nette ne reçoit ni « grosse séance » ni la comparaison avec les autres
  assert.ok(!pool('hard').includes(L.MIND_MAX));
  assert.ok(!pool('good').includes(L.MIND_ESPRIT));
});

test('profil « intense » (chambrage 5, sans humour interdit) : les 5 phrases sont dans son pool', () => {
  const intense = ctx({ cpBanterLevel: 5, cpPersonality: ['Compétiteur'] });
  for (const cat of ['neutral', 'first']) {
    const pool = L.mindsetPoolFor(cat, intense).map(textOf);
    for (const ph of NEW5()) assert.ok(pool.includes(ph), cat + ' : ' + ph);
  }
  // séance en dessous, humour permis : pool de base (mental + perf)
  const pq = L.mindsetPoolFor('pique', intense).map(textOf);
  assert.ok(pq.includes(L.MIND_ESPRIT) && pq.includes(L.MIND_PERF));
  // séance en dessous, humour interdit : pool intense complet
  const pq2 = L.mindsetPoolFor('pique', ctx({ cpBanterLevel: 5, cpDontDo: ['Trop familier'] })).map(textOf);
  for (const ph of NEW5()) assert.ok(pq2.includes(ph));
  // et elles sortent réellement (tirage déterministe par séance) : chacune apparaît sur 300 séances « plateau »
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(L.motivationQuote(neutralComp, { previous: 8000, current: 8000 }, 'n' + i, false, false, null, '', intense));
  for (const ph of NEW5()) assert.ok(seen.has(ph), 'jamais tirée : ' + ph);
});

test('profil « doux » (≤ 2, « trop agressif », chambrage ≤ 1) : jamais une de ces phrases, quelle que soit la performance', () => {
  const softs = [{ cpDontDo: ['Trop agressif'] }, { cpBanterLevel: 1 }, { cpBanterLevel: 2 }, { cpCoachStyle: ['Qui reste calme'], cpBanterLevel: 2 }];
  for (const sp of softs) for (const cat of CATS) {
    const pool = L.mindsetPoolFor(cat, ctx(sp)).map(textOf);
    for (const ph of NEW5()) assert.ok(!pool.includes(ph), JSON.stringify(sp) + ' / ' + cat + ' : ' + ph);
  }
  const mixed = { prsCount: 0, upCount: 2, downCount: 1, sameCount: 2, totalExercises: 5, exercises: [] };
  for (let i = 0; i < 200; i++) for (const [comp, vol] of [[neutralComp, { previous: 8000, current: 8000 }], [null, { previous: 9000, current: 6000 }], [mixed, null], [null, null]])
    for (const sp of softs) assert.ok(!NEW5().includes(L.motivationQuote(comp, vol, 's' + i, false, false, null, '', ctx(sp))), JSON.stringify(sp));
});

test('« culpabilisant » : aucune de ces phrases sur une baisse ; « me comparer aux autres » : jamais la phrase de comparaison', () => {
  const ng = ctx({ cpDontDo: ['Culpabilisant'], cpBanterLevel: 4 });
  const hard = L.mindsetPoolFor('hard', ng).map(textOf);
  for (const ph of NEW5()) assert.ok(!hard.includes(ph));
  // idem sur une séance « un peu en dessous » : aucune phrase qui pousse (mental / perf), même avec un chambrage élevé
  for (const prof of [{ cpDontDo: ['Culpabilisant'], cpBanterLevel: 4 }, { cpDontDo: ['Culpabilisant', 'Trop familier'], cpBanterLevel: 5 }]) {
    const pq = L.mindsetPoolFor('pique', ctx(prof)).map(textOf);
    assert.ok(pq.length > 0 && !pq.includes(L.MIND_ESPRIT) && !pq.includes(L.MIND_PERF), JSON.stringify(prof));
  }
  const nc = ctx({ cpDontDo: ['Me comparer aux autres'], cpBanterLevel: 5 });
  for (const cat of ['elite', 'good', 'pique', 'neutral', 'first']) assert.ok(!L.recapPoolFor(L.mindsetPoolFor(cat, nc), nc).map(textOf).includes(L.MIND_MAX), cat);
  assert.ok(L.recapPoolFor(L.mindsetPoolFor('elite', ctx({ cpBanterLevel: 5 })), ctx({ cpBanterLevel: 5 })).map(textOf).includes(L.MIND_MAX), 'sans la limite, elle reste');
});

test('décharge / reprise / douleurs de cycle et pools « style » : jamais ces phrases', () => {
  const intense = ctx({ cpBanterLevel: 5 });
  for (let i = 0; i < 100; i++) {
    for (const [d, post, why] of [[true, false, null], [true, false, 'menstrual'], [false, true, null]])
      assert.ok(!NEW5().includes(L.motivationQuote(neutralComp, null, 'd' + i, d, post, null, 'f', intense, why)));
  }
  for (const arr of Object.values(L.STYLE_MINDSET)) for (const t of arr) assert.ok(!NEW5().includes(t));
});

test('avant la séance : ces phrases sortent pour un profil standard/intense, jamais pour un profil doux', () => {
  const run = prof => { const out = new Set(); for (let i = 0; i < 400; i++) { const m = L.coachPreSessionMessage(ctx(prof), null, 'Laura', String(1000 + i)); out.add(m.message); } return out; };
  const mid = run({ cpNickname: 'Lau' });
  const hard = run({ cpBanterLevel: 5 });
  for (const ph of [L.MIND_PERF, L.MIND_SIGNAUX, L.MIND_ESPRIT, L.MIND_PERSEVERE]) { assert.ok(mid.has(ph) || hard.has(ph), ph); }
  const soft = run({ cpBanterLevel: 1 });
  for (const ph of NEW5()) assert.ok(!soft.has(ph));
});
