/* Prime Athlète — identité visuelle des PDF (séance, séance partagée, programme).
 *
 * Un seul module pour toutes les pages qui génèrent un PDF avec jsPDF (Muscu.html, share.html) : même charte,
 * mêmes cartes, même pied de page. Les helpers propres à chaque page (regroupement supersets, cardio…) sont
 * passés en paramètre, ce fichier ne dépend de rien d'autre que de jsPDF.
 *
 *   PrimePDF.session(jsPDF, session, helpers)  → doc jsPDF (fiche de séance)
 *   PrimePDF.aiProgram(jsPDF, program)         → doc jsPDF (programme d'entraînement)
 *
 * Polices : jsPDF n'embarque que les polices standard (WinAnsi) → pas d'emoji, pas de flèche « → », pas d'espace
 * fine (U+202F) : tout texte passe par clean(). Charte : noir #07090E, cuivre, bronze, champagne (comme le carrousel).
 */
(function (global) {
  'use strict';

  var C = {
    bg: [7, 9, 14], card: [17, 20, 29], card2: [23, 27, 38],
    line: [74, 62, 44], bronze: [143, 118, 80], copper: [200, 133, 91], champ: [232, 211, 168],
    white: [244, 242, 238], dim: [198, 200, 210], mute: [128, 132, 148], cool: [23, 56, 69],
    good: [44, 196, 160], blue: [90, 138, 224], violet: [160, 96, 208], amber: [214, 150, 70]
  };
  var W = 210, H = 297, M = 16, CW = W - M * 2, BOTTOM = 274;

  /* ── Logo : chargé une fois, en tâche de fond. Sans lui (hors ligne, fichier absent) le PDF utilise la marque en texte. ── */
  var LOGO = null, logoSettled = false;
  var logoReady = Promise.resolve(null);
  try {
    if (typeof fetch === 'function' && typeof FileReader !== 'undefined' && typeof Image !== 'undefined') {
      logoReady = fetch('/logo-watermark.png')
        .then(function (r) { return r.ok ? r.blob() : Promise.reject(new Error('logo')); })
        .then(function (b) {
          return new Promise(function (res, rej) {
            var fr = new FileReader();
            fr.onload = function () {
              var im = new Image();
              im.onload = function () { LOGO = { data: fr.result, w: im.naturalWidth, h: im.naturalHeight }; res(LOGO); };
              im.onerror = rej; im.src = fr.result;
            };
            fr.onerror = rej; fr.readAsDataURL(b);
          });
        })
        .catch(function () { return null; })
        .then(function (v) { logoSettled = true; return v; });
    } else { logoSettled = true; }
  } catch (e) { logoSettled = true; /* logo facultatif */ }

  /* ── utilitaires ── */
  function clean(s) {
    return String(s == null ? '' : s).replace(/[  ]/g, ' ').replace(/→/g, '>').replace(/[‘’]/g, '’');
  }
  function num(n) { return clean(Math.round(n || 0).toLocaleString('fr-FR')); }
  function dec(n) { return clean(String(n == null ? 0 : n).replace('.', ',')); }
  function fill(doc, c) { doc.setFillColor(c[0], c[1], c[2]); }
  function stroke(doc, c) { doc.setDrawColor(c[0], c[1], c[2]); }
  function ink(doc, c) { doc.setTextColor(c[0], c[1], c[2]); }
  function font(doc, size, bold, italic) { doc.setFontSize(size); doc.setFont('helvetica', bold ? (italic ? 'bolditalic' : 'bold') : (italic ? 'italic' : 'normal')); }
  function opacity(doc, a) { try { doc.setGState(new doc.GState({ opacity: a, 'stroke-opacity': a })); } catch (e) { /* ancien jsPDF : sans transparence */ } }
  function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
  // texte avec interlettrage (titres en capitales) ; la largeur est calculée à la main pour pouvoir aligner à droite
  function tracked(doc, txt, x, y, cs, align) {
    txt = clean(txt);
    doc.setCharSpace(0);
    var w = doc.getTextWidth(txt) + cs * Math.max(0, txt.length - 1);
    var px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    doc.setCharSpace(cs); doc.text(txt, px, y); doc.setCharSpace(0);
    return w;
  }
  function textW(doc, txt) { doc.setCharSpace(0); return doc.getTextWidth(clean(txt)); }
  // dégradé horizontal champagne → cuivre fabriqué avec des bandes
  function gradBar(doc, x, y, w, h, c1, c2, steps) {
    steps = steps || 48;
    var sw = w / steps;
    for (var i = 0; i < steps; i++) { fill(doc, mix(c1, c2, i / (steps - 1))); doc.rect(x + i * sw, y, sw + 0.15, h, 'F'); }
  }
  function card(doc, x, y, w, h, r, fillC, lineC) {
    fill(doc, fillC || C.card); stroke(doc, lineC || C.line); doc.setLineWidth(0.25);
    opacity(doc, 0.82);   // translucide : le logo en filigrane reste visible derrière les cartes
    doc.roundedRect(x, y, w, h, r == null ? 2.5 : r, r == null ? 2.5 : r, 'FD');
    opacity(doc, 1);
  }
  function pillW(doc, txt) { font(doc, 6.6, true); txt = clean(txt).toUpperCase(); return textW(doc, txt) + txt.length * 0.35 + 6; }
  function pillAt(doc, txt, xLeft, yMid, color) {
    font(doc, 6.6, true); txt = clean(txt).toUpperCase();
    var w = pillW(doc, txt);
    stroke(doc, color); doc.setLineWidth(0.3); fill(doc, C.card2);
    doc.roundedRect(xLeft, yMid - 3, w, 6, 3, 3, 'FD');
    ink(doc, color); tracked(doc, txt, xLeft + 3, yMid + 1.1, 0.35);
    return w;
  }
  // rangée de pastilles centrée sur xc
  function pillRow(doc, list, xc, yMid) {
    var gap = 2.4, total = 0, i;
    list.forEach(function (p, k) { total += pillW(doc, p[0]) + (k ? gap : 0); });
    var x = xc - total / 2;
    for (i = 0; i < list.length; i++) x += pillAt(doc, list[i][0], x, yMid, list[i][1]) + gap;
  }

  /* ── fond de page : noir, halos cuivre/bleu nuit, traits de vitesse (écho du logo), tranche dégradée à gauche ── */
  function paintPage(doc) {
    fill(doc, C.bg); doc.rect(0, 0, W, H, 'F');
    var i;
    fill(doc, C.copper);
    for (i = 0; i < 14; i++) { opacity(doc, 0.013); doc.circle(206, 2, 98 - i * 6.5, 'F'); }
    fill(doc, C.cool);
    for (i = 0; i < 12; i++) { opacity(doc, 0.022); doc.circle(-6, 302, 92 - i * 6.5, 'F'); }
    stroke(doc, C.champ); doc.setLineWidth(0.3);
    [[118, 0, 210, 40], [136, 0, 210, 31], [158, 0, 210, 21]].forEach(function (l, k) { opacity(doc, 0.13 - k * 0.03); doc.line(l[0], l[1], l[2], l[3]); });
    opacity(doc, 1);
    for (i = 0; i < 40; i++) { fill(doc, mix(C.champ, C.copper, i / 39)); doc.rect(0, i * (H / 40), 1.6, H / 40 + 0.2, 'F'); }
    // filigrane : le logo, centré au milieu de la page (visible à travers les cartes, légèrement translucides)
    if (LOGO && LOGO.data) {
      var lw = 150, lh = lw * LOGO.h / LOGO.w;
      opacity(doc, 0.085);
      try { doc.addImage(LOGO.data, 'PNG', (W - lw) / 2, (H - lh) / 2, lw, lh); } catch (e) { /* facultatif */ }
      opacity(doc, 1);
    }
  }

  /* ── marque : logo si chargé, sinon mot-symbole en texte ── */
  function brand(doc, x, y, w) {
    if (LOGO && LOGO.data) {
      var h = w * LOGO.h / LOGO.w;
      try { doc.addImage(LOGO.data, 'PNG', x, y, w, h); return h; } catch (e) { /* retombe sur le texte */ }
    }
    font(doc, w * 0.34, true); ink(doc, C.white); tracked(doc, 'PRIME', x, y + w * 0.25, w * 0.02);
    font(doc, w * 0.2, true); ink(doc, C.copper); tracked(doc, 'ATHLÈTE', x, y + w * 0.43, w * 0.04);
    return w * 0.45;
  }

  /* ── document : pagination + pied de page posé à la fin (numéros « 1 / 3 ») ── */
  function Builder(jsPDF, footerNote) {
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    try { doc.setProperties({ title: 'Prime Athlète', author: 'Prime Athlète', creator: 'Prime Athlète' }); } catch (e) { /* facultatif */ }
    var b = { doc: doc, y: 0, footerNote: footerNote || 'Suivi sportif · Mesure ta progression' };
    paintPage(doc);
    b.page = function () { doc.addPage(); paintPage(doc); b.y = 24; };
    b.ensure = function (h) { if (b.y + h > BOTTOM) b.page(); };
    b.finish = function () {
      var n = doc.getNumberOfPages(), p;
      for (p = 1; p <= n; p++) {
        doc.setPage(p);
        stroke(doc, C.line); doc.setLineWidth(0.25); doc.line(M, 282.5, W - M, 282.5);
        var lw = 15, lh = brand(doc, (W - lw) / 2, 284.6, lw);
        font(doc, 6.6, false); ink(doc, C.mute);
        var note = b.footerNote.toUpperCase(), page = p + ' / ' + n;
        doc.setCharSpace(0);
        var w1 = textW(doc, note) + note.length * 0.5, w2 = textW(doc, page) + page.length * 0.6, gap = 7;
        var x0 = (W - (w1 + gap + w2)) / 2, yy = 284.6 + lh + 3.4;
        tracked(doc, note, x0, yy, 0.5);
        font(doc, 7, true); ink(doc, C.champ); tracked(doc, page, x0 + w1 + gap, yy, 0.6);
      }
      return doc;
    };
    return b;
  }

  /* ── en-tête de première page : logo, type de document, filet dégradé, titre, date, indicateurs ── */
  function cover(b, o) {
    var doc = b.doc, y = 14, xc = W / 2;
    var lw = 58, lh = brand(doc, (W - lw) / 2, y, lw);
    y += lh + 6.5;
    font(doc, 7.6, true); ink(doc, C.copper); tracked(doc, o.kind, xc, y, 1.6, 'center');
    y += 5.5;
    gradBar(doc, M, y, CW, 0.9, C.champ, C.copper, 64);
    y += 12;
    // titre : capitales centrées, taille adaptée à la longueur, 2 lignes maximum
    var title = clean(o.title || '').toUpperCase();
    var size = title.length > 34 ? 19 : title.length > 22 ? 23 : 28;
    font(doc, size, true); ink(doc, C.white);
    var lines = doc.splitTextToSize(title, CW).slice(0, 2);
    lines.forEach(function (l) { doc.text(l, xc, y + size * 0.3, { align: 'center' }); y += size * 0.42; });
    y += 2.5;
    fill(doc, C.copper); doc.roundedRect(xc - 9, y, 18, 1.1, 0.5, 0.5, 'F');
    y += 7;
    if (o.meta) {
      font(doc, 9.5, false); var mt = clean(o.meta), mw = textW(doc, mt);
      fill(doc, C.copper); doc.circle(xc - mw / 2 - 3.2, y - 1.2, 0.9, 'F');
      ink(doc, C.dim); doc.text(mt, xc + 1.2, y, { align: 'center' });
      y += 9;
    }
    if (o.kpis && o.kpis.length) {
      var n = o.kpis.length, gap = 4, kw = (CW - gap * (n - 1)) / n, kh = 23;
      o.kpis.forEach(function (k, i) {
        var x = M + i * (kw + gap), cx = x + kw / 2;
        card(doc, x, y, kw, kh, 2.6);
        fill(doc, C.copper); doc.rect(cx - 3, y + 4, 6, 0.7, 'F');
        font(doc, 16.5, true); var v = clean(k.value), vw = textW(doc, v);
        font(doc, 8.5, false); var uw = k.unit ? textW(doc, clean(k.unit)) + 1.6 : 0;
        var sx = cx - (vw + uw) / 2;
        font(doc, 16.5, true); ink(doc, C.champ); doc.text(v, sx, y + 13.6);
        if (k.unit) { font(doc, 8.5, false); ink(doc, C.mute); doc.text(clean(k.unit), sx + vw + 1.6, y + 13.6); }
        font(doc, 6.4, true); ink(doc, C.mute); tracked(doc, k.label.toUpperCase(), cx, y + 19, 0.5, 'center');
      });
      y += kh + 9;
    }
    b.y = y;
  }

  /* ── carte d'exercice ──
   * ex = { n, name, muscle, color, tag, kind: 'sets'|'tiles', sets:[{w,r,v,note,top}], tiles:[[label,value]],
   *        rest, total, tip } */
  function exerciseCard(b, ex) {
    var doc = b.doc, pad = 6, rowH = 6.6;
    var pills = [];
    if (ex.tag) pills.push([ex.tag, ex.color || C.copper]);
    if (ex.muscle) pills.push([ex.muscle, C.bronze]);
    var h = 13 + (pills.length ? 9.5 : 1);                 // nom + pastilles
    if (ex.kind === 'sets') {
      h += 7;                                             // titres de colonnes
      (ex.sets || []).forEach(function (s) { h += rowH + (s.note ? 4.6 : 0); });
      if (ex.rest || ex.total) h += 9;
      h += 3;
    } else {
      h += 19 + 3;
      if (ex.rest) h += 6;
    }
    var tipLines = [];
    if (ex.tip) { font(doc, 8.6, false, true); tipLines = doc.splitTextToSize(clean(ex.tip), CW - pad * 2 - 8); h += tipLines.length * 4 + 3; }
    b.ensure(h + 4);
    var x = M, y = b.y, w = CW, xc = x + w / 2;
    card(doc, x, y, w, h, 3);
    fill(doc, ex.color || C.copper); doc.roundedRect(x, y + 3, 1.3, h - 6, 0.6, 0.6, 'F');
    // numéro + nom, centrés ensemble
    font(doc, 12, true);
    var nm = doc.splitTextToSize(clean(ex.name || 'Exercice'), w - pad * 2 - 16)[0];
    var nmW = textW(doc, nm), grp = 8 + 3 + nmW, gx = xc - grp / 2, cy = y + 7.6;
    stroke(doc, ex.color || C.copper); doc.setLineWidth(0.5); fill(doc, C.card2); doc.circle(gx + 4, cy, 3.9, 'FD');
    font(doc, 9, true); ink(doc, C.champ); doc.text(String(ex.n), gx + 4, cy + 1.2, { align: 'center' });
    font(doc, 12, true); ink(doc, C.white); doc.text(nm, gx + 11, cy + 1.6);
    var yy = y + 13;
    if (pills.length) { pillRow(doc, pills, xc, yy + 3.2); yy += 9.5; } else { yy += 1; }
    if (ex.kind === 'sets') {
      var x0 = x + pad, uw = w - pad * 2;
      var cxs = [0, 1, 2, 3].map(function (i) { return x0 + uw * (i + 0.5) / 4; });
      font(doc, 6.4, true); ink(doc, C.mute);
      ['SÉRIE', 'POIDS', 'RÉPÉTITIONS', 'VOLUME'].forEach(function (l, i) { tracked(doc, l, cxs[i], yy + 3.4, 0.6, 'center'); });
      stroke(doc, C.line); doc.setLineWidth(0.2); doc.line(x0, yy + 5.2, x0 + uw, yy + 5.2);
      yy += 7;
      (ex.sets || []).forEach(function (s, i) {
        if (i % 2 === 0) { fill(doc, C.card2); opacity(doc, 0.7); doc.rect(x0 - 1, yy - 0.2, uw + 2, rowH, 'F'); opacity(doc, 1); }
        if (s.top) { fill(doc, C.copper); doc.rect(x0 - 1, yy - 0.2, 1, rowH, 'F'); }
        var base = yy + 4.5;
        font(doc, 9, true); ink(doc, C.copper); doc.text(String(i + 1), cxs[0], base, { align: 'center' });
        font(doc, 10, false); ink(doc, C.white); doc.text(dec(s.w) + ' kg', cxs[1], base, { align: 'center' });
        doc.text(String(s.r) + ' reps', cxs[2], base, { align: 'center' });
        font(doc, 10, true); ink(doc, s.top ? C.champ : C.dim); doc.text(num(s.v) + ' kg', cxs[3], base, { align: 'center' });
        yy += rowH;
        if (s.note) { font(doc, 7.8, false, true); ink(doc, C.mute); doc.text('Note : ' + clean(s.note), xc, yy + 3, { align: 'center' }); yy += 4.6; }
      });
      if (ex.rest || ex.total) {
        yy += 1.2;
        stroke(doc, C.line); doc.setLineWidth(0.2); doc.line(x0, yy, x0 + uw, yy);
        // une seule ligne centrée : Repos · Volume de l'exercice
        var segs = [];
        if (ex.rest) segs.push({ t: 'Repos : ' + clean(ex.rest), f: [7.6, false], c: C.mute });
        if (ex.total) segs.push({ t: 'VOLUME DE L\u2019EXERCICE', f: [6.4, true], c: C.mute, cs: 0.5 }, { t: num(ex.total) + ' kg', f: [9, true], c: C.champ });
        var gapS = [], tw = 0;
        segs.forEach(function (sg, k) { font(doc, sg.f[0], sg.f[1]); sg.w = textW(doc, sg.t) + (sg.cs ? sg.t.length * sg.cs : 0); var g = k === 0 ? 0 : (segs[k - 1].cs && !sg.cs ? 2.6 : 8); sg.g = g; tw += sg.w + g; });
        var sx = xc - tw / 2;
        segs.forEach(function (sg) { sx += sg.g; font(doc, sg.f[0], sg.f[1]); ink(doc, sg.c); if (sg.cs) tracked(doc, sg.t, sx, yy + 5.4, sg.cs); else doc.text(sg.t, sx, yy + 5.4); sx += sg.w; });
        yy += 9;
      }
    } else {
      var tiles = ex.tiles && ex.tiles.length ? ex.tiles : [['MESURES', '\u2014']];
      var n = tiles.length, gap = 3.5, tw2 = (w - pad * 2 - gap * (n - 1)) / n;
      tiles.forEach(function (t, i) {
        var tx = x + pad + i * (tw2 + gap), tcx = tx + tw2 / 2;
        fill(doc, C.card2); stroke(doc, C.line); doc.setLineWidth(0.2); doc.roundedRect(tx, yy, tw2, 16, 2, 2, 'FD');
        font(doc, 6.2, true); ink(doc, C.mute); tracked(doc, t[0].toUpperCase(), tcx, yy + 5.2, 0.5, 'center');
        font(doc, 13, true); ink(doc, C.champ); doc.text(clean(t[1]), tcx, yy + 12.4, { align: 'center' });
      });
      yy += 19;
      if (ex.rest) { font(doc, 7.6, false); ink(doc, C.mute); doc.text('Repos : ' + clean(ex.rest), xc, yy + 2.6, { align: 'center' }); yy += 6; }
    }
    if (tipLines.length) {
      font(doc, 8.6, false, true); ink(doc, C.dim);
      tipLines.forEach(function (l, i) { doc.text(l, xc, yy + 2.8 + i * 4, { align: 'center' }); });
    }
    b.y = y + h + 4.5;
  }

  /* ── bandeau de groupe (superset, tri-set, circuit abdos) ── */
  function groupLabel(b, label, color) {
    var doc = b.doc;
    b.ensure(40);
    font(doc, 7.6, true); label = clean(label).toUpperCase();
    doc.setCharSpace(0); var lw = textW(doc, label) + label.length * 0.9, xc = W / 2;
    fill(doc, color); doc.circle(xc - lw / 2 - 3.2, b.y + 2.2, 1.1, 'F');
    ink(doc, color); tracked(doc, label, xc, b.y + 3.2, 0.9, 'center');
    b.y += 8;
  }

  /* ── bloc de texte (ressenti, feedback, conseil) : carte centrée à barre latérale colorée ── */
  function quoteCard(b, label, text, color) {
    var doc = b.doc, pad = 6, xc = M + CW / 2;
    font(doc, 9.4, false); var lines = doc.splitTextToSize(clean(text), CW - pad * 2 - 8);
    var lineH = 4.5, maxPerPage = Math.floor((BOTTOM - 40) / lineH), chunk, first = true;
    while (lines.length) {
      chunk = lines.splice(0, Math.min(lines.length, maxPerPage - 4));
      var h = 13 + chunk.length * lineH + 3;
      b.ensure(h + 4);
      var y = b.y;
      card(doc, M, y, CW, h, 3);
      fill(doc, color); doc.roundedRect(M, y + 3, 1.6, h - 6, 0.7, 0.7, 'F');
      font(doc, 6.8, true); ink(doc, color); tracked(doc, (first ? label : label + ' (suite)').toUpperCase(), xc, y + 7.4, 0.9, 'center');
      font(doc, 9.4, false); ink(doc, C.dim);
      chunk.forEach(function (l, i) { doc.text(l, xc, y + 13.2 + i * lineH, { align: 'center' }); });
      b.y = y + h + 4.5; first = false;
    }
  }

  /* ───────────────────────── fiche de séance ───────────────────────── */
  var GROUP_LABEL = { superset: 'Superset', triset: 'Tri-set', abdos: 'Circuit abdos' };
  var GROUP_COLOR = { superset: C.blue, triset: C.violet, abdos: C.good };

  function session(jsPDF, s, h) {
    var b = Builder(jsPDF);
    var doc = b.doc;
    var exercises = s.exercises || [];
    var d = new Date(s.date);
    var meta = isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    meta = meta ? meta.charAt(0).toUpperCase() + meta.slice(1) : '';
    var kpis = [];
    if (s.totalVolume) kpis.push({ value: num(s.totalVolume), unit: 'kg', label: 'Volume total' });
    if (s.duration) kpis.push({ value: String(s.duration), unit: 'min', label: 'Durée' });
    if (s.rpe) kpis.push({ value: String(s.rpe), unit: '/ 10', label: 'Effort perçu (RPE)' });
    kpis.push({ value: String(exercises.length), unit: exercises.length > 1 ? 'exercices' : 'exercice', label: 'Au programme' });
    cover(b, { kind: 'FICHE DE SÉANCE', title: s.name || 'Séance', meta: meta, kpis: kpis.slice(0, 4) });

    var n = 0;
    h.groupExercisesByType(exercises).forEach(function (g) {
      var complex = GROUP_LABEL[g.type];
      if (complex) groupLabel(b, GROUP_LABEL[g.type] + ' · enchaîné sans repos', GROUP_COLOR[g.type]);
      g.items.forEach(function (ex) {
        n++;
        var model = { n: n, name: ex.name, muscle: ex.muscle, color: complex ? GROUP_COLOR[g.type] : C.copper };
        var rest = ex.restSeconds > 0 ? ex.restSeconds + ' s' : '';
        if (h.exType(ex) === 'cardio') {
          var c = ex.cardio || {}, t = [];
          if (h.cardioHasVal(c.duree)) t.push(['Durée', h.cardioDuree(c.duree)]);
          if (h.cardioHasVal(c.vitesse)) t.push(['Vitesse', h.fixCardioVal(c.vitesse) + ' km/h']);
          if (h.cardioHasVal(c.inclinaison)) t.push(['Inclinaison', h.fixCardioVal(c.inclinaison) + ' %']);
          if (h.cardioHasVal(c.distance)) t.push(['Distance visée', h.fixCardioVal(c.distance) + ' km']);
          if (h.cardioDistanceTotal && h.cardioDistanceTotal(ex.sets) > 0) t.push(['Réalisé', h.fmtDistanceM(h.cardioDistanceTotal(ex.sets))]);
          model.kind = 'tiles'; model.tag = 'Cardio'; model.color = C.amber; model.tiles = t.slice(0, 4);
        } else if (ex.holdSeconds > 0) {
          var ns = (ex.sets || []).length || 1;
          model.kind = 'tiles'; model.tag = 'Gainage'; model.color = C.blue; model.rest = rest;
          model.tiles = [['Séries', String(ns)], ['Tenue par série', h.fmtHoldDuration(ex.holdSeconds)]];
        } else {
          var sets = (ex.sets || []).map(function (st) {
            var w = +st.weight || 0, r = +st.reps || 0;
            return { w: w, r: r, v: w * r, note: st.note ? String(st.note) : '' };
          });
          var best = -1, bi = -1;
          sets.forEach(function (st, i) { if (st.v > best) { best = st.v; bi = i; } });
          if (sets.length > 1 && best > 0) sets[bi].top = true;
          model.kind = 'sets'; model.sets = sets; model.rest = rest;
          var total = sets.reduce(function (a, st) { return a + st.v; }, 0);
          if (total > 0 && sets.length > 1) model.total = total;
        }
        exerciseCard(b, model);
      });
    });
    if (!exercises.length) {
      font(doc, 10, false, true); ink(doc, C.mute); doc.text('Aucun exercice dans cette séance.', M, b.y + 4);
      b.y += 10;
    }
    if (s.notes) quoteCard(b, 'Mon ressenti', s.notes, C.copper);
    if (s.coachFeedback) quoteCard(b, 'Feedback du coach', s.coachFeedback, C.blue);
    return b.finish();
  }

  /* ───────────────────────── programme d'entraînement ───────────────────────── */
  function aiProgram(jsPDF, p) {
    var b = Builder(jsPDF);
    var doc = b.doc;
    var d = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    var exs = p.exercises || [];
    var kpis = [{ value: String(exs.length), unit: exs.length > 1 ? 'exercices' : 'exercice', label: 'Au programme' }];
    var nSets = exs.reduce(function (a, e) { return a + (parseInt(e.sets, 10) || 3); }, 0);
    if (exs.length) kpis.push({ value: String(nSets), unit: 'séries', label: 'Au total' });
    cover(b, { kind: 'PROGRAMME D\u2019ENTRAÎNEMENT', title: p.name || 'Programme',
      meta: [p.muscles, 'Créé le ' + d].filter(Boolean).join('  ·  '), kpis: kpis });
    if (p.tip) quoteCard(b, 'Conseil', p.tip, C.champ);
    exs.forEach(function (e, i) {
      exerciseCard(b, { n: i + 1, name: e.name || 'Exercice', muscle: e.muscle, color: C.copper, kind: 'tiles',
        tiles: [['Séries', String(e.sets || 3)], ['Répétitions', String(e.reps || '-')], ['Repos', String(e.rest || '60 s')]],
        tip: e.tip || '' });
    });
    return b.finish();
  }

  // Appelle fn tout de suite si le logo est prêt (cas normal) ; sinon attend-le au plus 2 s, puis génère quand même.
  function whenReady(fn) {
    if (logoSettled) return fn();
    var done = false, go = function () { if (!done) { done = true; fn(); } };
    logoReady.then(go);
    setTimeout(go, 2000);
  }

  global.PrimePDF = { session: session, aiProgram: aiProgram, whenReady: whenReady, logoReady: logoReady, clean: clean };
})(typeof window !== 'undefined' ? window : this);
