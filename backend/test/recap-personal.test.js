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
  + slice('// Hash déterministe', 'function sessionVolumeOf');
const L = new Function('gg', SRC + '\nreturn { biasMindsetPool, athleteRegressionText, computeCoachCtx, recapPersonalLines, recapPoolFor, congratsMessage, motivationQuote, MOTIVATION_ELITE, MOTIVATION_GOOD, MINDSET_HARSH };')((g, a, b) => b);

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
