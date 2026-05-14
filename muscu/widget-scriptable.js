// Prime Athl Widget — Scriptable (iOS)
// 1. Installe l'app gratuite "Scriptable" sur l'App Store
// 2. Ouvre Scriptable → "+" → colle ce script entier → nomme-le "Prime Athl"
// 3. Ajoute un widget Scriptable sur ton écran d'accueil (long-press écran → + → Scriptable)
// 4. Tape le widget → "Edit Widget" → choisis le script "Prime Athl"
// 5. Renseigne TOKEN et BACKEND_URL ci-dessous

const TOKEN = "REMPLACE_PAR_TON_TOKEN";
const BACKEND_URL = "https://cash-switches-introductory-goals.trycloudflare.com";

// Pour récupérer ton TOKEN :
// - Ouvre Prime Athl dans Safari
// - Tape sur l'icône Partager → ajoute un signet
// - Ou : F12 / Inspect → Console → tape : localStorage.getItem('pa_token')

const widget = new ListWidget();
widget.backgroundGradient = (() => {
  const g = new LinearGradient();
  g.colors = [new Color("#1a0a18"), new Color("#06060a")];
  g.locations = [0, 1];
  return g;
})();
widget.setPadding(14, 14, 14, 14);

try {
  const req = new Request(`${BACKEND_URL}/api/widget`);
  req.headers = { Authorization: `Bearer ${TOKEN}` };
  const data = await req.loadJSON();

  // Header
  const head = widget.addStack();
  head.layoutHorizontally();
  const title = head.addText("PRIME ATHL");
  title.font = Font.boldSystemFont(9);
  title.textColor = new Color("#ff6b00");
  head.addSpacer();
  const name = head.addText(data.firstName || (data.role === "coach" ? "Coach" : "Athlète"));
  name.font = Font.semiboldSystemFont(10);
  name.textColor = new Color("#f5f5f7");
  widget.addSpacer(8);

  // Next day or last
  if (data.nextDay) {
    const t = widget.addText(data.nextDay.name);
    t.font = Font.heavySystemFont(20);
    t.textColor = new Color("#ffffff");
    const sub = widget.addText(`${data.nextDay.category || ""} · ${data.nextDay.exerciseCount} exos`);
    sub.font = Font.systemFont(10);
    sub.textColor = new Color("#a0a0b0");
  } else {
    const t = widget.addText("Pas de prog");
    t.font = Font.heavySystemFont(18);
    t.textColor = new Color("#ffffff");
    const sub = widget.addText("Importe ton programme");
    sub.font = Font.systemFont(10);
    sub.textColor = new Color("#a0a0b0");
  }
  widget.addSpacer();

  // Week stats
  const stats = widget.addStack();
  stats.layoutHorizontally();
  const left = stats.addStack();
  left.layoutVertically();
  const v1 = left.addText(`${data.weekStats.sessions}`);
  v1.font = Font.heavySystemFont(22);
  v1.textColor = new Color("#ff6b00");
  const l1 = left.addText("séances");
  l1.font = Font.systemFont(9);
  l1.textColor = new Color("#a0a0b0");
  stats.addSpacer();
  const right = stats.addStack();
  right.layoutVertically();
  right.setPadding(0, 0, 0, 0);
  const v2 = right.addText(`${Math.round(data.weekStats.volume / 1000)}k`);
  v2.font = Font.heavySystemFont(22);
  v2.textColor = new Color("#ff2e9a");
  const l2 = right.addText("kg cette sem.");
  l2.font = Font.systemFont(9);
  l2.textColor = new Color("#a0a0b0");
} catch (e) {
  const err = widget.addText("Erreur : " + e.message);
  err.font = Font.systemFont(10);
  err.textColor = new Color("#ff2e9a");
}

widget.url = BACKEND_URL + "/Muscu.html";

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentSmall();
}
Script.complete();
