// PrimeAudio (bips de décompte + sonnerie de fin de repos) : logique de robustesse testée avec de
// fausses API audio (pas de navigateur) — les causes réelles de « ça ne sonne pas chez certains ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/Muscu.html'), 'utf8');
const start = html.indexOf('const PrimeAudio=(()=>{');
const end = html.indexOf('\n})();', start) + '\n})();'.length;
assert.ok(start > 0 && end > start, 'PrimeAudio introuvable');
const SRC = html.slice(start, end);

// Fabrique un environnement audio factice et instancie PrimeAudio dedans.
function makeEnv({ ctxState = 'running', playRejects = false, audioSession = true, noAudioContext = false } = {}) {
  const log = { oscillators: 0, resumes: 0, audioPlays: [], ctxCreated: 0, sessionType: null };
  class FakeCtx {
    constructor() { log.ctxCreated++; this.state = ctxState; this.currentTime = 0; this.destination = {}; FakeCtx.last = this; }
    resume() { log.resumes++; this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start() {}, set buffer(_) {} }; }
    createOscillator() { log.oscillators++; return { connect() {}, start() {}, stop() {}, frequency: {} }; }
    createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  }
  class FakeAudio {
    constructor(src) { this.src = src; this.muted = false; this.volume = 1; this.currentTime = 0; FakeAudio.last = this; }
    play() { log.audioPlays.push({ muted: this.muted }); return playRejects && !this.muted ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); }
    pause() {}
  }
  const win = noAudioContext ? {} : { AudioContext: FakeCtx };
  const nav = audioSession ? { audioSession: { get type() { return log.sessionType; }, set type(v) { log.sessionType = v; } } } : {};
  const URLfake = { createObjectURL: () => 'blob:fake' };
  class FakeBlob { constructor(parts) { this.size = parts[0].byteLength; } }
  const PrimeAudio = new Function('window', 'navigator', 'Audio', 'URL', 'Blob', SRC + '\nreturn PrimeAudio;')(win, nav, FakeAudio, URLfake, FakeBlob);
  return { PrimeAudio, log, FakeCtx, FakeAudio };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('unlock : passe la session audio iOS en « ambient » (cohabite avec la musique, ne la coupe pas) et bénit l\'élément de sonnerie', async () => {
  const { PrimeAudio, log } = makeEnv();
  PrimeAudio.unlock();
  await tick();
  assert.equal(log.sessionType, 'ambient');
  assert.notEqual(log.sessionType, 'playback', 'ne doit plus réclamer le canal audio en exclusif');
  assert.equal(log.audioPlays.length, 1, 'lecture muette de déblocage');
  assert.equal(log.audioPlays[0].muted, true);
});

test('ring : joue la sonnerie via l\'élément <audio> (canal média), pas via Web Audio', async () => {
  const { PrimeAudio, log } = makeEnv();
  PrimeAudio.unlock(); await tick();
  const before = log.audioPlays.length;
  PrimeAudio.ring(); await tick();
  assert.equal(log.audioPlays.length, before + 1);
  assert.equal(log.audioPlays.at(-1).muted, false, 'sonnerie audible');
  assert.equal(log.oscillators, 0, 'pas de secours Web Audio quand <audio> marche');
});

test('ring : si <audio> est refusé, repli sur Web Audio (6 bips = 3 doubles-bips)', async () => {
  const { PrimeAudio, log } = makeEnv({ playRejects: true });
  PrimeAudio.unlock(); await tick();
  PrimeAudio.ring(); await tick();
  assert.equal(log.oscillators, 6);
});

test('un AudioContext « suspended » ou « interrupted » est repris avant de sonner', async () => {
  for (const state of ['suspended', 'interrupted']) {
    const { PrimeAudio, log, FakeCtx } = makeEnv({ ctxState: state });
    PrimeAudio.beep(880, 1, 0.3);
    assert.ok(log.resumes >= 1, `resume() appelé pour l'état ${state}`);
    assert.equal(FakeCtx.last.state, 'running');
    assert.equal(log.oscillators, 1);
  }
});

test('un AudioContext fermé par le navigateur est recréé', () => {
  const { PrimeAudio, log, FakeCtx } = makeEnv();
  PrimeAudio.beep(700, 0.3, 0.1);
  assert.equal(log.ctxCreated, 1);
  FakeCtx.last.state = 'closed';
  PrimeAudio.beep(700, 0.3, 0.1);
  assert.equal(log.ctxCreated, 2, 'nouveau contexte après fermeture');
  assert.equal(log.oscillators, 2);
});

test('navigateur sans Web Audio ni audioSession : aucune exception', () => {
  const { PrimeAudio } = makeEnv({ noAudioContext: true, audioSession: false });
  assert.doesNotThrow(() => { PrimeAudio.unlock(); PrimeAudio.beep(880, 1, 0.3); PrimeAudio.ring(); });
});

test('front : « Passer le repos » et le changement d\'exercice ne déclenchent pas la sonnerie ; pas de toast « Repos terminé » en doublon', () => {
  assert.match(html, /const skipRest=React\.useCallback\(\(\)=>\{restSkippedRef\.current=true;setRestSeconds\(0\);\},\[\]\);/);
  assert.equal((html.match(/onClick=\{skipRest\}/g) || []).length, 2, 'les 2 boutons « passer le repos »');
  assert.match(html, /title="Passer le repos"/);
  assert.match(html, /restSkippedRef\.current=true;\s*setCurrentEx\(idx\);setRestSeconds\(0\);setRestTotal\(0\);/);
  assert.doesNotMatch(html, /c'est reparti !/);
  assert.doesNotMatch(html, /restDoneToast|restDoneFlash/);
  // tout tap ré-arme l'audio
  assert.match(html, /document\.addEventListener\('touchend',arm/);
});
