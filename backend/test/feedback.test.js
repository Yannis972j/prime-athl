// Feedback coach → athlète : le feedback doit toujours arriver, et un échec ne doit jamais être silencieux.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');

let srv, coachToken, athleteToken, sessionId;
before(async () => {
  srv = await startServer();
  const login = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } });
  coachToken = login.body.token;
  await api(srv.baseUrl, 'POST', '/api/coach/create-athlete', { token: coachToken, body: { email: 'fbA@test.local', password: 'longenough1' } });
  const la = await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: 'fbA@test.local', password: 'longenough1' } });
  athleteToken = la.body.token;
  const s = await api(srv.baseUrl, 'POST', '/api/sessions', { token: athleteToken, body: { name: 'LEGS · FESSIERS', date: new Date().toISOString(), totalVolume: 100, exercises: [{ name: 'Hip thrust', sets: [{ weight: 100, reps: 10, done: true }] }] } });
  sessionId = s.body.id;
});
after(async () => { if (srv) await srv.stop(); });

test('feedback du coach : livré à l\'athlète (en attente) ET visible dans sa séance', async () => {
  const r = await api(srv.baseUrl, 'POST', `/api/coach/sessions/${sessionId}/feedback`, { token: coachToken, body: { feedback: 'RDL passe à 65kg' } });
  assert.equal(r.status, 200);
  const prog = await api(srv.baseUrl, 'GET', '/api/program', { token: athleteToken });
  assert.equal(prog.body.pendingCoachFeedback.feedback, 'RDL passe à 65kg');
  assert.equal(prog.body.pendingCoachFeedback.sessionName, 'LEGS · FESSIERS');
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken });
  assert.equal(list.body.find(x => x.id === sessionId).coachFeedback, 'RDL passe à 65kg');
});

test('acquittement : la popup en attente disparaît, le feedback reste dans la séance', async () => {
  const a = await api(srv.baseUrl, 'POST', '/api/my-coach-feedback/ack', { token: athleteToken });
  assert.equal(a.status, 200);
  const prog = await api(srv.baseUrl, 'GET', '/api/program', { token: athleteToken });
  assert.equal(prog.body.pendingCoachFeedback, null);
  const list = await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken });
  assert.equal(list.body.find(x => x.id === sessionId).coachFeedback, 'RDL passe à 65kg');
});

test('feedback sur une séance introuvable : 404 not_found (erreur explicite relayée au coach)', async () => {
  const r = await api(srv.baseUrl, 'POST', '/api/coach/sessions/inconnue/feedback', { token: coachToken, body: { feedback: 'test' } });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not_found');
});

test('front : la popup ne s\'ouvre qu\'au démarrage d\'une séance du MÊME NOM (sinon le feedback attend)', () => {
  assert.match(html, /const match=wn\?pendingFeedbacks\.find\(f=>normSessionKey\(f\.sessionName\)===wn\):null;\s*if\(match\)\{\s*setActiveCoachFeedback\(match\)/);
  // plus aucune ouverture inconditionnelle sur n'importe quelle séance
  assert.doesNotMatch(html, /if\(pendingCoachFeedback&&!coachSessionTarget\)/);
  // un feedback en attente reste accessible via une carte dans l'onglet Séances
  assert.match(html, /a commenté « \{f\.sessionName\} »/);
  // rappel retrouvé dans l'historique quand la popup a déjà été lue
  assert.match(html, /last&&last\.coachFeedback[\s\S]{0,200}setSessionCoachFeedback/);
});

test('file d\'attente : un feedback par séance, un 2e feedback n\'écrase plus le 1er, ack ciblé', async () => {
  const mk = async (name) => (await api(srv.baseUrl, 'POST', '/api/sessions', { token: athleteToken, body: { name, date: new Date().toISOString(), totalVolume: 50, exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5, done: true }] }] } })).body.id;
  const idPush = await mk('PUSH · POITRINE');
  const idPull = await mk('PULL · DOS');
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${idPush}/feedback`, { token: coachToken, body: { feedback: 'fb push' } });
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${idPull}/feedback`, { token: coachToken, body: { feedback: 'fb pull' } });
  let prog = await api(srv.baseUrl, 'GET', '/api/program', { token: athleteToken });
  assert.deepEqual(prog.body.pendingCoachFeedbacks.map(f => f.sessionName).sort(), ['PULL · DOS', 'PUSH · POITRINE']);
  // un feedback plus récent sur une séance de même nom (ponctuation différente) remplace l'ancien
  const idPush2 = await mk('Push poitrine');
  await api(srv.baseUrl, 'POST', `/api/coach/sessions/${idPush2}/feedback`, { token: coachToken, body: { feedback: 'fb push v2' } });
  prog = await api(srv.baseUrl, 'GET', '/api/program', { token: athleteToken });
  assert.equal(prog.body.pendingCoachFeedbacks.length, 2);
  assert.equal(prog.body.pendingCoachFeedbacks.find(f => /push/i.test(f.sessionName)).feedback, 'fb push v2');
  // ack ciblé : seul PUSH disparaît, PULL reste en attente
  await api(srv.baseUrl, 'POST', '/api/my-coach-feedback/ack', { token: athleteToken, body: { sessionId: idPush2 } });
  prog = await api(srv.baseUrl, 'GET', '/api/program', { token: athleteToken });
  assert.deepEqual(prog.body.pendingCoachFeedbacks.map(f => f.feedback), ['fb pull']);
  assert.equal(prog.body.pendingCoachFeedback.feedback, 'fb pull');
  // ack sans corps : tout est effacé (anciens clients)
  await api(srv.baseUrl, 'POST', '/api/my-coach-feedback/ack', { token: athleteToken });
  prog = await api(srv.baseUrl, 'GET', '/api/program', { token: athleteToken });
  assert.deepEqual(prog.body.pendingCoachFeedbacks, []);
});

test('front : le récap de la séance commentée s\'ouvre dans une fenêtre en bas depuis la popup', () => {
  assert.match(html, /function FeedbackRecapSheet\(/);
  assert.match(html, /Voir le récap de ta séance/);
  assert.match(html, /activeCoachFeedback&&showFeedbackRecap&&feedbackRecap&&<FeedbackRecapSheet/);
  // le récap est calculé par la comparaison commune (même logique que les autres récaps)
  assert.match(html, /const feedbackRecap=React\.useMemo\([\s\S]{0,400}buildSessionComparison\(sess,history/);
});

test('front : un échec d\'envoi du feedback est affiché au coach (plus de catch silencieux)', () => {
  assert.match(html, /setFeedbackError\(/);
  assert.match(html, /feedbackError&&<div role="alert"/);
  const hook = html.slice(html.indexOf('function useSessionFeedback('), html.indexOf('function useSessionFeedback(') + 1800);
  assert.doesNotMatch(hook, /\}catch\{\}/, 'catch vide supprimé dans useSessionFeedback');
});

test('front : popup feedback et fenêtre récap sont rendues via portal sur le body (sinon fixed piégé par willChange du gestureRef → hors écran en paysage)', () => {
  assert.match(html, /\{activeCoachFeedback&&ReactDOM\.createPortal\(/);
  const a = html.indexOf('function FeedbackRecapSheet');
  assert.match(html.slice(a, a + 6000), /return ReactDOM\.createPortal\(/);
  assert.doesNotMatch(html, /calc\(104px \+ env\(safe-area-inset-bottom\)\)',boxSizing|maxHeight:'8[68]vh'[^}]{0,40}104px/);
});

test('front : la carte de la séance du jour affiche TOUS les exercices (plus de « +N exercices » tronqué à 6)', () => {
  const a = html.indexOf("const labelMap={CLASSIQUE:'CLASSIQUE'");
  assert.ok(a > 0);
  const block = html.slice(a, a + 4500);
  assert.doesNotMatch(block, /shown>=6/);
  assert.doesNotMatch(block, /\+\{rem\} exercices/);
});

test('front : « pas de prog » n\'existe plus dans la liste des athlètes (nom du programme, Séances ou Biblio)', () => {
  assert.doesNotMatch(html, /pas de prog/);
  assert.match(html, /function athleteProgramLabel\(/);
});

test('front : le calendrier coach retrouve TOUTES les séances d\'un même jour (voir, déplacer, supprimer chacune)', () => {
  const a = html.indexOf('const openSession=async(ath,dateStr)');
  assert.ok(a > 0);
  const block = html.slice(a, a + 2200);
  assert.match(block, /\.filter\(x=>x\.date&&ymdKey\(new Date\(x\.date\)\)===dateStr\)/);
  assert.doesNotMatch(block, /sessions\.find\(x=>x\.date&&ymdKey/);
  assert.match(html, /const afterSessionGone=\(goneId,msg\)/);
  assert.match(html, /data-testid="day-session-pick"/);
  assert.match(html, /n>1\?n\+' séances':'Séance'/);
});

test('API coach : déplacer l\'une des 2 séances d\'un jour laisse l\'autre en place ; supprimer l\'autre la retire seule', async () => {
  const mk = async (name, date) => (await api(srv.baseUrl, 'POST', '/api/sessions', { token: athleteToken, body: { name, date, totalVolume: 10, exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5, done: true }] }] } })).body.id;
  const d1 = '2026-03-10T09:00:00.000Z', d2 = '2026-03-10T18:30:00.000Z';
  const s1 = await mk('MATIN', d1), s2 = await mk('SOIR', d2);
  const mv = await api(srv.baseUrl, 'PATCH', `/api/coach/sessions/${s2}`, { token: coachToken, body: { date: '2026-03-11T12:00:00.000Z' } });
  assert.equal(mv.status, 200);
  let list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken })).body;
  assert.equal(list.find(x => x.id === s1).date, d1);
  assert.equal(list.find(x => x.id === s2).date, '2026-03-11T12:00:00.000Z');
  const del = await api(srv.baseUrl, 'DELETE', `/api/coach/sessions/${s1}`, { token: coachToken });
  assert.equal(del.status, 200);
  list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token: athleteToken })).body;
  assert.ok(!list.find(x => x.id === s1));
  assert.ok(list.find(x => x.id === s2));
});

test('front : flushPendingSessions a une garde anti-concurrence + le snapshot porte un clientId', () => {
  assert.match(html, /flushingRef\.current/);
  assert.match(html, /if\(flushingRef\.current\)return;/);
  assert.match(html, /if\(!snapshot\.clientId\)snapshot\.clientId=uid\(\);/);
});
