// Notification du soir : prépare mentalement l'athlète à la séance de DEMAIN + félicitation / relance selon l'activité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldSendActivityNotif, activitySummary, sessionOnDate, tomorrowPlan, pickDailyMessage, postSessionSendAt, weeklyCadence, toneLimits, pickPostSessionMessage, POST_SESSION_MESSAGES, eligibleForActivityNotifs, wantsEveningNudge } from '../daily-activity.js';

// « Maintenant » = 4 nov. 2026 (mercredi) 20:30 en Martinique = 5 nov. 00:30 UTC
const NOW = Date.UTC(2026, 10, 5, 0, 30);
const TODAY = '2026-11-04';
const ago = (d, h = 0) => new Date(NOW - d * 86400000 - h * 3600000).toISOString();
const S = (d, extra = {}, h = 0) => ({ id: 's' + d + h, date: ago(d, h), name: 'PUSH', totalVolume: 4200, ...extra });
const day = (cat, n = 5) => ({ category: cat, exercises: Array.from({ length: n }, (_, i) => ({ name: 'Ex' + i })) });
const NO = { kind: 'unknown' };
const msg = (sessions, user = {}, plan = NO) => pickDailyMessage(activitySummary(sessions, NOW), { id: 'u1', firstName: 'Léa', ...user }, NOW, plan);

test('planification : à partir de 20 h Martinique, une fois par jour, rattrapable jusqu\'à 23 h', () => {
  const at = (h, m = 0) => Date.UTC(2026, 10, 4, h + 4, m); // h = heure Martinique
  assert.equal(shouldSendActivityNotif(at(19, 59), null).due, false);
  assert.equal(shouldSendActivityNotif(at(20, 0), null).due, true);
  assert.equal(shouldSendActivityNotif(at(22, 59), null).due, true, 'tick manqué rattrapé');
  assert.equal(shouldSendActivityNotif(at(23, 0), null).due, false);
  assert.equal(shouldSendActivityNotif(at(21, 0), '2026-11-04').due, false, 'déjà envoyé aujourd\'hui');
  assert.equal(shouldSendActivityNotif(at(21, 0), '2026-11-03').due, true);
});

test('séance de demain : lue dans le programme (jour de la semaine en Martinique), avec nom et nombre d\'exercices', () => {
  const data = { programs: { u1: { data: { S1: { JEUDI: day('JAMBES — Quad', 6), LUNDI: day('DOS') } } } } };
  assert.deepEqual(sessionOnDate(data, 'u1', '2026-11-05'), { has: true, label: 'JAMBES — Quad', exCount: 6 }); // jeudi
  assert.equal(sessionOnDate(data, 'u1', '2026-11-06').has, false); // vendredi
  assert.deepEqual(tomorrowPlan(data, 'u1', TODAY), { kind: 'session', label: 'JAMBES — Quad', exCount: 6 });
});

test('séance déplacée par le coach : suit le déplacement (arrivée ET départ)', () => {
  const programs = { u1: { data: { S1: { JEUDI: day('JAMBES'), VENDREDI: day('DOS') } } } };
  // la séance du jeudi 5 est déplacée au vendredi 6 : jeudi libre, vendredi = JAMBES (et plus DOS ce jour-là)
  const scheduleMoves = { u1: { '2026-11-06': { sourceDayName: 'JEUDI', sourceDate: '2026-11-05' } } };
  const t = tomorrowPlan({ programs, scheduleMoves }, 'u1', TODAY);
  assert.equal(t.kind, 'rest', 'jeudi (source déplacée) = repos');
  assert.equal(t.nextDay, 'vendredi');
  assert.equal(t.nextLabel, 'JAMBES');
});

test('séance planifiée par le coach ou l\'athlète pour demain : annoncée, même sans programme', () => {
  const data = { plannedSessions: { u1: { '2026-11-05': [{ name: 'PUSH — Pecs', exercises: [1, 2, 3] }] } } };
  assert.deepEqual(tomorrowPlan(data, 'u1', TODAY), { kind: 'session', label: 'PUSH — Pecs', exCount: 3 });
});

test('programmes multiples avec noms différents ce jour-là : pas de nom inventé ; sans programme : « inconnu »', () => {
  const data = { programs: { u1: { data: { A: { JEUDI: day('JAMBES') }, B: { JEUDI: day('DOS') } } } } };
  assert.deepEqual(tomorrowPlan(data, 'u1', TODAY), { kind: 'session', label: null, exCount: 5 });
  assert.deepEqual(tomorrowPlan({ programs: {} }, 'u2', TODAY), { kind: 'unknown' });
});

test('séance annoncée : titre « Demain : … », félicitation du jour + consigne de préparation mentale', () => {
  const plan = { kind: 'session', label: 'JAMBES — Quad', exCount: 6 };
  const m = msg([S(0, {}, 3)], {}, plan);
  assert.equal(m.title, '🌙 Demain : JAMBES — Quad');
  assert.match(m.body, /Séance du jour validée — 4 200 kg soulevés/);
  assert.match(m.body, /Couche-toi|Visualise|sac|Dîne|objectif|écran|Respire|prêt/);
});

test('jour de repos demain : récupération + prochaine séance ; inconnu : « Prépare ta prochaine séance »', () => {
  const rest = msg([S(1)], {}, { kind: 'rest', nextDay: 'vendredi', nextLabel: 'DOS' });
  assert.equal(rest.title, '🌙 Demain : récupération');
  assert.match(rest.body, /Prochaine séance : vendredi — DOS/);
  assert.match(rest.body, /récup|repos|Hydrate|Étirements/i);
  assert.equal(msg([S(1)]).title, '🌙 Prépare ta prochaine séance');
});

test('« aujourd\'hui » suit le fuseau Martinique ; une date future n\'est pas de l\'activité', () => {
  const future = { id: 'f', date: new Date(NOW + 3 * 3600000).toISOString(), name: 'X', totalVolume: 1 };
  assert.equal(activitySummary([future], NOW).total, 0);
  // 22:00 Martinique le 4 nov. (= 02:00 UTC le 5) → aujourd'hui ; 23 h la veille (03:00 UTC le 4) → hier
  assert.equal(activitySummary([{ id: 'a', date: new Date(Date.UTC(2026, 10, 5, 0, 10)).toISOString(), name: 'Y' }], NOW).todaySessions.length, 1);
  const y = activitySummary([{ id: 'b', date: new Date(Date.UTC(2026, 10, 4, 3, 0)).toISOString(), name: 'Z' }], NOW);
  assert.equal(y.todaySessions.length, 0);
  assert.equal(y.daysSince, 1);
});

test('activité → bon message d\'ouverture : séance du jour, objectif hebdo atteint AUJOURD\'HUI, cycle, décharge', () => {
  assert.equal(msg([S(0, {}, 2), S(1), S(2), S(4)], { goalWeeklyTarget: 4 }).kind, 'week_goal');
  assert.match(msg([S(0, {}, 2), S(1), S(2), S(4)], { goalWeeklyTarget: 4 }).body, /4\/4/);
  assert.equal(msg([S(0, {}, 2), S(1), S(2), S(3), S(5)], { goalWeeklyTarget: 3 }).kind, 'done_today', 'objectif déjà atteint avant aujourd\'hui');
  const c = msg([S(0, { deload: true, lightReason: 'menstrual' }, 2)], { gender: 'f' });
  assert.equal(c.kind, 'cycle'); assert.match(c.body, /écouté ton corps/);
  assert.equal(msg([S(0, { deload: true, lightReason: 'session' }, 2)]).kind, 'deload');
});

test('pas de séance aujourd\'hui : régularité, hier, courte pause, longue pause, jamais entraîné', () => {
  assert.equal(msg([S(1), S(2), S(3)]).kind, 'streak');
  assert.equal(msg([S(1)]).kind, 'yesterday');
  assert.equal(msg([S(3)]).kind, 'short_break');
  assert.equal(msg([S(9)]).kind, 'long_break');
  assert.equal(msg([]).kind, 'new');
  assert.equal(msg([S(2), S(3)], { goalWeeklyTarget: 5 }).kind, 'short_break');
});

test('accords au féminin, surnom, et message stable dans la journée', () => {
  const plan = { kind: 'session', label: 'DOS', exCount: 4 };
  const bodies = g => Array.from({ length: 40 }, (_, i) => msg([S(1)], { id: 'user' + i, gender: g }, plan).body).join('\n');
  assert.match(bodies('f'), /prête/);
  assert.doesNotMatch(bodies('h'), /prête/);
  assert.match(msg([S(1), S(2), S(3)], { cpNickname: 'Championne' }, plan).body, /Championne/);
  assert.deepEqual(msg([S(0, {}, 3)], {}, plan), msg([S(0, {}, 3)], {}, plan), 'déterministe pour un même jour');
  const tips = new Set(Array.from({ length: 40 }, (_, i) => msg([S(1)], { id: 'user' + i }, plan).body));
  assert.ok(tips.size > 3, 'les consignes de préparation varient d\'un athlète à l\'autre');
});

test('ton : jamais culpabilisant ; titre ≤ 48 et corps ≤ 170 caractères ; tag fixe (remplace le message de la veille)', () => {
  const plans = [NO, { kind: 'session', label: 'UN NOM DE SÉANCE VRAIMENT TRÈS TRÈS LONG POUR TESTER', exCount: 9 }, { kind: 'rest', nextDay: 'mercredi', nextLabel: 'UNE AUTRE SÉANCE AU NOM INTERMINABLE' }];
  for (const sessions of [[S(0, {}, 3)], [S(9)], [S(30)], [S(3)], [S(1), S(2), S(3)], []]) {
    for (const plan of plans) {
      const m = msg(sessions, { goalWeeklyTarget: 4, cpNickname: 'Nickname' }, plan);
      assert.doesNotMatch(m.title + ' ' + m.body, /honte|paresse|nul\b|raté|décevant|abandon|excuse|problème/i, m.kind);
      assert.equal(m.tag, 'daily-activity');
      assert.ok(m.title.length <= 48, 'titre : ' + m.title);
      assert.ok(m.body.length <= 170, `corps ${m.body.length} : ${m.body}`);
    }
  }
});

test('serveur : branché sur le planificateur, athlètes actifs seulement, accès expiré exclu, plan de demain transmis', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.js'), 'utf8');
  assert.match(src, /shouldSendActivityNotif\(Date\.now\(\), DATA\.meta\?\.activityNotifLastRun/);
  assert.match(src, /DATA\.meta\.activityNotifLastRun = act\.dateStr;\s*persist\(\);\s*sendDailyActivity\(\)/, 'date du dernier envoi persistée AVANT l\'envoi');
  assert.match(src, /!eligibleForActivityNotifs\(u\) \|\| isAccessExpired\(u\)/);
  assert.match(src, /tomorrowPlan\(\{ programs: DATA\.programs, scheduleMoves: DATA\.scheduleMoves, plannedSessions: DATA\.plannedSessions \}/);
});

// ── Message APRÈS la séance ──────────────────────────────────────────────────────────────────────────────────
const local = (h, m = 0, dayOfNov = 4) => Date.UTC(2026, 10, dayOfNov, h + 4, m); // heure locale Martinique (UTC-4)
const hm = ms => { const d = new Date(ms - 4 * 3600000); return String(d.getUTCDate()).padStart(2, '0') + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };

test('après séance : heure d\'envoi selon l\'heure de fin (avant 12 h → 18 h ; 12-18 h → 20 h ; 20-23 h → +1 h ; ≥ 23 h → rien)', () => {
  assert.equal(hm(postSessionSendAt(local(7, 15))), '04 18:00', 'séance du matin → 18 h');
  assert.equal(hm(postSessionSendAt(local(11, 59))), '04 18:00', 'juste avant midi → 18 h');
  assert.equal(hm(postSessionSendAt(local(12, 0))), '04 20:00', 'midi pile → 20 h');
  assert.equal(hm(postSessionSendAt(local(17, 59))), '04 20:00', 'avant 18 h → 20 h');
  assert.equal(hm(postSessionSendAt(local(18, 30))), '04 20:00', '18-20 h : pas avant 20 h');
  assert.equal(hm(postSessionSendAt(local(19, 40))), '04 20:40', '19 h 40 → 1 h après (jamais moins d\'1 h)');
  assert.equal(hm(postSessionSendAt(local(20, 0))), '04 21:00', '20 h → 21 h');
  assert.equal(hm(postSessionSendAt(local(21, 45))), '04 22:45', '1 h après');
  assert.equal(hm(postSessionSendAt(local(22, 59))), '04 23:59', 'dernière minute encore le même jour');
  assert.equal(postSessionSendAt(local(23, 0)), null, 'à partir de 23 h : pas d\'envoi');
  // les secondes de fin de séance ne décalent pas l'heure pile
  assert.equal(hm(postSessionSendAt(local(10, 0) + 37000)), '04 18:00');
});

test('après séance : choix du message selon activité et régularité (5 messages, textes exacts)', () => {
  assert.equal(POST_SESSION_MESSAGES.length, 5);
  assert.equal(POST_SESSION_MESSAGES[0], 'Demain, une nouvelle bataille t\'attend. Prépare ton mental, ton corps suivra.');
  assert.equal(POST_SESSION_MESSAGES[3], 'Demain, ne cherche pas d\'excuses. Souviens-toi pourquoi tu as commencé.');
  const sessionTmr = { kind: 'session', label: 'DOS', exCount: 5 };
  const at = (h, sessions, user, plan, cadence = 3) => {
    // « maintenant » = juste après la séance du jour (à l'heure h)
    const sess = sessions.map(x => x.__today ? { ...x, date: new Date(local(h, 0)).toISOString() } : x);
    const now = local(h, 5);
    return pickPostSessionMessage(activitySummary(sess, now), { id: 'u', firstName: 'Léa', ...user }, plan, { cadence });
  };
  const T = { id: 't', __today: true, name: 'PUSH', totalVolume: 1 };
  const old = d => ({ id: 'o' + d, date: new Date(local(10, 0) - d * 86400000).toISOString(), name: 'X' });
  assert.equal(at(10, [T, old(1), old(2)], {}, sessionTmr).idx, 1, 'régulier (3 séances/7 j) + séance demain → « la régularité forge »');
  assert.equal(at(10, [T, old(1)], {}, sessionTmr, 5).idx, 1, 'enchaîne 2 jours de suite → « la régularité forge »');
  assert.equal(at(10, [T, old(3)], {}, sessionTmr, 3).idx, 0, 'rythme normal, séance demain → « nouvelle bataille »');
  assert.equal(at(10, [T, old(3)], {}, sessionTmr, 4).idx, 0, 'séance il y a 3 jours avec un rythme de 4/semaine : pas en retard (pas de reproche)');
  assert.equal(at(10, [T, old(5)], {}, sessionTmr, 4).idx, 3, 'écart de 5 jours avec un rythme de 4/semaine → décrochage');
  assert.equal(at(10, [T, old(4)], {}, sessionTmr, 3).idx, 0, '4 jours d\'écart avec un rythme de 3/semaine : seuil de décrochage = 5 jours, donc pas en retard');
  assert.equal(at(10, [T, old(4)], {}, sessionTmr, 2).idx, 1, 'rythme de 2/semaine tenu (2 séances sur 7 jours) → régularité');
  assert.equal(at(10, [T, old(8)], {}, sessionTmr).idx, 3, 'reprise après une pause + séance demain → « pas d\'excuses »');
  assert.equal(at(10, [T, old(1), old(2)], {}, { kind: 'rest' }).idx, 4, 'demain repos → « un pas de plus »');
  assert.equal(at(10, [T, old(2)], {}, { kind: 'unknown' }).idx, 4, 'sans programme → « un pas de plus »');
  assert.equal(at(21, [T, old(1)], {}, sessionTmr).idx, 2, 'séance tardive (≥ 20 h) → « le repos de ce soir »');
  assert.equal(at(21, [T, old(8)], {}, { kind: 'rest' }).idx, 2, 'séance tardive, même demain repos');
});

test('après séance : « pas d\'excuses » jamais pour qui a demandé un ton doux ; « trop de messages » repéré', () => {
  const sess = [{ id: 't', date: new Date(local(10, 0)).toISOString(), name: 'P', totalVolume: 1 }, { id: 'o', date: new Date(local(10, 0) - 8 * 86400000).toISOString(), name: 'X' }];
  const sum = activitySummary(sess, local(10, 5));
  const plan = { kind: 'session', label: 'DOS' };
  assert.equal(pickPostSessionMessage(sum, { id: 'a' }, plan).idx, 3);
  for (const dont of [['Culpabilisant'], ['Trop agressif'], ['Trop de messages']]) {
    assert.notEqual(pickPostSessionMessage(sum, { id: 'a', cpDontDo: dont }, plan).idx, 3, dont[0]);
  }
  assert.equal(toneLimits({ cpDontDo: ['Trop de messages'] }).tooMany, true);
  assert.equal(toneLimits({}).tooMany, false);
});

test('après séance : titre = séance de demain / récupération / « Séance validée » ; rythme attendu lu dans le profil ou le programme', () => {
  const sum = activitySummary([{ id: 't', date: new Date(local(10, 0)).toISOString(), name: 'P' }], local(10, 5));
  assert.equal(pickPostSessionMessage(sum, { id: 'a' }, { kind: 'session', label: 'JAMBES' }).title, '🌙 Demain : JAMBES');
  assert.equal(pickPostSessionMessage(sum, { id: 'a' }, { kind: 'rest' }).title, '🌙 Demain : récupération');
  assert.equal(pickPostSessionMessage(sum, { id: 'a', firstName: 'Léa' }, { kind: 'unknown' }).title, '💪 Séance validée, Léa');
  assert.equal(weeklyCadence({ id: 'a', goalWeeklyTarget: 5 }, {}), 5);
  const programs = { a: { data: { S1: { LUNDI: day('A'), MERCREDI: day('B'), VENDREDI: day('C'), SAMEDI: day('D') } } } };
  assert.equal(weeklyCadence({ id: 'a' }, { programs }), 4, 'nombre de jours du programme');
  assert.equal(weeklyCadence({ id: 'b' }, { programs }), 3, 'défaut');
});

test('après séance : une séance saisie rétroactivement (jour passé) ne déclenche rien aujourd\'hui', () => {
  const retro = { id: 'r', date: new Date(local(12, 0, 2)).toISOString(), name: 'Rétro', totalVolume: 1 }; // midi le 2 nov.
  assert.equal(activitySummary([retro], local(21, 0)).todaySessions.length, 0);
});

test('qui reçoit les notifications du soir : athlètes actifs + coach principal (qui s\'entraîne aussi), pas les autres coachs', () => {
  assert.equal(eligibleForActivityNotifs({ role: 'athlete', status: 'active' }), true);
  assert.equal(eligibleForActivityNotifs({ role: 'athlete', status: 'inactive' }), false);
  assert.equal(eligibleForActivityNotifs({ role: 'coach', status: 'active', isMainCoach: true }), true);
  assert.equal(eligibleForActivityNotifs({ role: 'coach', status: 'active' }), false);
  assert.equal(eligibleForActivityNotifs(null), false);
  // le coach sans aucune séance enregistrée ne reçoit pas la relance de 20 h ; un athlète oui
  assert.equal(wantsEveningNudge({ role: 'coach', isMainCoach: true }, 0), false);
  assert.equal(wantsEveningNudge({ role: 'coach', isMainCoach: true }, 12), true);
  assert.equal(wantsEveningNudge({ role: 'athlete' }, 0), true);
});

test('serveur : envoi après séance une fois par jour (date persistée), fenêtre de rattrapage, accès expiré/« trop de messages » exclus', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server.js'), 'utf8');
  assert.match(src, /sendPostSessionNotifications\(\);\s*\}, 60 \* 1000\)/, 'appelé par le planificateur à la minute');
  assert.match(src, /u\.postSessionNotified === lt\.dateStr \|\| toneLimits\(u\)\.tooMany/);
  assert.match(src, /now < sendAt \|\| now - sendAt > POST_SESSION_CATCHUP_MS/);
  assert.match(src, /u\.postSessionNotified = lt\.dateStr;/);
  assert.match(src, /if \(sum\.todaySessions\.length \|\| toneLimits\(u\)\.tooMany\) continue;/, 'le message de 20 h ne vise que ceux qui ne se sont pas entraînés');
});
