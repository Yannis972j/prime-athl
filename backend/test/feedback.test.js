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

test('front : la popup athlète n\'est plus conditionnée au nom de la séance démarrée', () => {
  // effet qui ouvre la popup dès que le feedback est connu (hors séance en cours)
  assert.match(html, /if\(!pendingCoachFeedback\|\|activeCoachFeedback\)return;[\s\S]{0,400}setActiveCoachFeedback\(pendingCoachFeedback\)/);
  // rappel en séance retrouvé dans l'historique quand la popup a déjà été lue
  assert.match(html, /last&&last\.coachFeedback[\s\S]{0,200}setSessionCoachFeedback/);
});

test('front : un échec d\'envoi du feedback est affiché au coach (plus de catch silencieux)', () => {
  assert.match(html, /setFeedbackError\(/);
  assert.match(html, /feedbackError&&<div role="alert"/);
  const hook = html.slice(html.indexOf('function useSessionFeedback('), html.indexOf('function useSessionFeedback(') + 1800);
  assert.doesNotMatch(hook, /\}catch\{\}/, 'catch vide supprimé dans useSessionFeedback');
});
