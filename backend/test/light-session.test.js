// Allègement d'UNE séance (décharge ponctuelle / douleurs menstruelles) :
// - calcul des valeurs allégées (front, lightenExercise) ;
// - le serveur conserve la raison (lightReason) pour adapter le récap, liste fermée ;
// - les boutons sont branchés dans la Bibliothèque ET le calendrier du programme.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, api, MAIN_COACH_EMAIL, MAIN_COACH_PASSWORD } from './helpers/server.js';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
const slice = (startMarker, endMarker) => { const a = html.indexOf(startMarker); const b = html.indexOf(endMarker, a); assert.ok(a > 0 && b > a, startMarker); return html.slice(a, b); };
const SRC = slice('const DELOAD_WEIGHT_PCT', '// Réglages d\'allègement');
const { lightenExercise } = new Function(SRC + '\nreturn { lightenExercise };')();

const ex = () => ({ name: 'Squat', weightStr: '100', repsStr: '8', restSeconds: 120,
  sets: [100, 100, 100, 100].map(w => ({ weight: w, reps: 8 })) });

test('décharge ponctuelle : charges à 60 % (arrondi 2,5 kg), séries −40 %', () => {
  const r = lightenExercise(ex(), 'deload');
  assert.equal(r.sets.length, 2);           // 4 × 0,6 = 2,4 → 2
  assert.equal(r.sets[0].weight, 60);
  assert.equal(r.weightStr, '60');
  assert.equal(r.repsStr, '8');
  assert.equal(r.restSeconds, 120);
});

test('douleurs de cycle : charges à 70 %, séries −30 %', () => {
  const r = lightenExercise(ex(), 'menstrual');
  assert.equal(r.sets.length, 3);           // 4 × 0,7 = 2,8 → 3
  assert.equal(r.sets[0].weight, 70);
  assert.equal(r.weightStr, '70');
});

test('aucun mode : exercice inchangé ; une seule série reste une série', () => {
  const e = ex();
  assert.equal(lightenExercise(e, null), e);
  const one = { name: 'Dips', sets: [{ weight: 0, reps: 10 }] };
  assert.equal(lightenExercise(one, 'deload').sets.length, 1);
});

test('front : boutons dans la Bibliothèque et le calendrier, drapeaux transmis à la séance', () => {
  // Bibliothèque : décharge séance + règles douloureuses (femmes uniquement)
  assert.match(html, /<LightToggleCard items=\{gender==='f'\?\['deload','menstrual'\]:\['deload'\]\} value=\{lightMode\}/);
  // Calendrier : une seule carte regroupe semaine / séance / cycle (cycle = femmes uniquement)
  assert.match(html, /<LightToggleCard items=\{\['week','deload',\.\.\.\(profile\?\.gender==='f'\?\['menstrual'\]:\[\]\)\]\}/);
  assert.match(html, /<LightToggleCard items=\{\['week'\]\} value=\{deloadMode\?'week':null\} onChange=\{toggleDeload\}\/>/);
  assert.match(html, /label: 'Douleurs de cycle'/);
  assert.match(html, /week: \{ icon: 'calendar', label: 'Décharge semaine'/);
  assert.match(html, /deload: \{ icon: 'arrowDown', label: 'Décharge séance'/);
  assert.match(html, /lightReason:lightMode==='menstrual'\?'menstrual':'session'/);
  assert.match(html, /lightReason:light==='menstrual'\?'menstrual':'session'/);
  assert.match(html, /\.\.\.\(workout\.lightReason\?\{lightReason:workout\.lightReason\}:\{\}\)/);
});

let srv, token;
before(async () => {
  srv = await startServer();
  token = (await api(srv.baseUrl, 'POST', '/api/auth/login', { body: { email: MAIN_COACH_EMAIL, password: MAIN_COACH_PASSWORD } })).body.token;
});
after(async () => { if (srv) await srv.stop(); });

const post = (extra, cid) => api(srv.baseUrl, 'POST', '/api/sessions', { token, body: { name: 'LEGS', date: new Date().toISOString(), totalVolume: 100, clientId: cid, exercises: [{ name: 'Squat', sets: [{ weight: 50, reps: 2, done: true }] }], ...extra } });

test('serveur : lightReason conservé (menstrual / session), ignoré si invalide ou sans décharge', async () => {
  const a = await post({ deload: true, lightReason: 'menstrual' }, 'l1');
  const b = await post({ deload: true, lightReason: 'session' }, 'l2');
  const c = await post({ deload: true, lightReason: '<script>' }, 'l3');
  const d = await post({ lightReason: 'menstrual' }, 'l4');
  const list = (await api(srv.baseUrl, 'GET', '/api/sessions', { token })).body;
  const arr = Array.isArray(list) ? list : (list.sessions || []);
  const byId = id => arr.find(s => s.id === id);
  assert.equal(byId(a.body.id).lightReason, 'menstrual');
  assert.equal(byId(a.body.id).deload, true);
  assert.equal(byId(b.body.id).lightReason, 'session');
  assert.equal(byId(c.body.id).lightReason, undefined);
  assert.equal(byId(d.body.id).lightReason, undefined);
  assert.equal(byId(d.body.id).deload, false);
});
