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

test('front : la popup s\'ouvre au DÉMARRAGE de toute séance (plus seulement si le nom coïncide)', () => {
  // au démarrage : popup ouverte dès qu'un feedback est en attente, sans condition sur le nom de la séance
  assert.match(html, /if\(pendingCoachFeedback&&!coachSessionTarget\)\{[\s\S]{0,500}setActiveCoachFeedback\(pendingCoachFeedback\);setShowFeedbackRecap\(false\);/);
  // le nom ne sert plus qu'au rappel dans la séance
  assert.match(html, /if\(wn&&fn&&wn===fn\)setSessionCoachFeedback\(pendingCoachFeedback\);/);
  // rappel retrouvé dans l'historique quand la popup a déjà été lue
  assert.match(html, /last&&last\.coachFeedback[\s\S]{0,200}setSessionCoachFeedback/);
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
