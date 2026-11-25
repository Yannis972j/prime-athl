/* Prime Athlète — identité visuelle des PDF (séance, séance partagée, programme IA).
 *
 * Un seul module pour toutes les pages qui génèrent un PDF avec jsPDF (Muscu.html, share.html) : même charte,
 * mêmes cartes, même pied de page. Les helpers propres à chaque page (regroupement supersets, cardio…) sont
 * passés en paramètre, ce fichier ne dépend de rien d'autre que de jsPDF.
 *
 *   PrimePDF.session(jsPDF, session, helpers)  → doc jsPDF (fiche de séance)
 *   PrimePDF.aiProgram(jsPDF, program)         → doc jsPDF (programme généré par IA)
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
  var W = 210, H = 297, M = 16, CW = W - M * 2, BOTTOM = 276;

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
    doc.roundedRect(x, y, w, h, r == null ? 2.5 : r, r == null ? 2.5 : r, 'FD');
  }
  function pill(doc, txt, xRight, yMid, color) {
    font(doc, 6.6, true); txt = clean(txt).toUpperCase();
    var w = textW(doc, txt) + txt.length * 0.35 + 6;
    stroke(doc, color); doc.setLineWidth(0.3); fill(doc, C.card2);
    doc.roundedRect(xRight - w, yMid - 3, w, 6, 3, 3, 'FD');
    ink(doc, color); tracked(doc, txt, xRight - w + 3, yMid + 1.1, 0.35);
    return w;
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
    // filigrane : le logo, très discret, en bas à droite (visible entre les cartes)
    if (LOGO && LOGO.data) {
      var lw = 150, lh = lw * LOGO.h / LOGO.w;
      opacity(doc, 0.035);
      try { doc.addImage(LOGO.data, 'PNG', W - lw + 18, H - lh - 26, lw, lh); } catch (e) { /* facultatif */ }
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
        stroke(doc, C.line); doc.setLineWidth(0.25); doc.line(M, 284, W - M, 284);
        brand(doc, M, 286.4, 13);
        font(doc, 6.8, false); ink(doc, C.mute);
        tracked(doc, b.footerNote.toUpperCase(), W / 2, 290.2, 0.5, 'center');
        font(doc, 7.5, true); ink(doc, C.champ);
        tracked(doc, p + ' / ' + n, W - M, 290.2, 0.6, 'right');
      }
      return doc;
    };
    return b;
  }

  /* ── en-tête de première page : logo, type de document, filet dégradé, titre, date, indicateurs ── */
  function cover(b, o) {
    var doc = b.doc, y = 15;
    var lh = brand(doc, M, y, 54);
    font(doc, 7.6, true); ink(doc, C.copper); tracked(doc, o.kind, W - M, y + 5.2, 1.4, 'right');
    font(doc, 7, false); ink(doc, C.mute); tracked(doc, o.sub, W - M, y + 10.2, 0.8, 'right');
    y += lh + 7;
    gradBar(doc, M, y, CW, 0.9, C.champ, C.copper, 64);
    y += 11;
    // titre : capitales, taille adaptée à la longueur, 2 lignes maximum
    var title = clean(o.title || '').toUpperCase();
    var size = title.length > 34 ? 19 : title.length > 22 ? 23 : 28;
    font(doc, size, true); ink(doc, C.white);
    var lines = doc.splitTextToSize(title, CW).slice(0, 2);
    lines.forEach(function (l) { doc.text(l, M, y + size * 0.3); y += size * 0.42; });
    y += 2.5;
    fill(doc, C.copper); doc.roundedRect(M, y, 18, 1.1, 0.5, 0.5, 'F');
    y += 6.5;
    if (o.meta) {
      fill(doc, C.copper); doc.circle(M + 1.1, y - 1.2, 0.9, 'F');
      font(doc, 9.5, false); ink(doc, C.dim); doc.text(clean(o.meta), M + 4, y);
      y += 8;
    }
    if (o.kpis && o.kpis.length) {
      var n = o.kpis.length, gap = 4, kw = (CW - gap * (n - 1)) / n, kh = 22;
      o.kpis.forEach(function (k, i) {
        var x = M + i * (kw + gap);
        card(doc, x, y, kw, kh, 2.6);
        fill(doc, C.copper); doc.rect(x + 4, y + 4.2, 6, 0.7, 'F');
        font(doc, 16.5, true); ink(doc, C.champ);
        var v = clean(k.value); doc.text(v, x + 4, y + 13.8);
        if (k.unit) { var vw = textW(doc, v); font(doc, 8.5, false); ink(doc, C.mute); doc.text(clean(k.unit), x + 4 + vw + 1.6, y + 13.8); }
        font(doc, 6.4, true); ink(doc, C.mute); tracked(doc, k.label.toUpperCase(), x + 4, y + 18.8, 0.5);
      });
      y += kh + 9;
    }
    b.y = y;
  }

  /* ── carte d'exercice ──
   * ex = { n, name, muscle, color, tag, kind: 'sets'|'tiles', sets:[{w,r,v,note,top}], tiles:[[label,value]],
   *        rest, total, tip } */
  function exerciseCard(b, ex) {
    var doc = b.doc, pad = 6;
    var rowH = 6.6;
    var h = 14;                                           // en-tête
    if (ex.kind === 'sets') {
      h += 7;                                             // titres de colonnes
      (ex.sets || []).forEach(function (s) { h += rowH + (s.note ? 4.6 : 0); });
      if (ex.rest || ex.total) h += 8;
      h += 3;
    } else {
      h += 19 + 3;
      if (ex.rest) h += 6;
    }
    var tipLines = [];
    if (ex.tip) { font(doc, 8.6, false, true); tipLines = doc.splitTextToSize(clean(ex.tip), CW - pad * 2 - 4); h += tipLines.length * 4 + 3; }
    b.ensure(h + 4);
    var x = M, y = b.y, w = CW;
    card(doc, x, y, w, h, 3);
    fill(doc, ex.color || C.copper); doc.roundedRect(x, y + 3, 1.3, h - 6, 0.6, 0.6, 'F');
    // numéro + nom + muscle
    var cx = x + pad + 3.6, cy = y + 7.4;
    stroke(doc, ex.color || C.copper); doc.setLineWidth(0.5); fill(doc, C.card2); doc.circle(cx, cy, 3.9, 'FD');
    font(doc, 9, true); ink(doc, C.champ); doc.text(String(ex.n), cx, cy + 1.2, { align: 'center' });
    font(doc, 12, true); ink(doc, C.white);
    var nameMax = w - pad * 2 - 12 - (ex.muscle ? 44 : 0);
    var nm = doc.splitTextToSize(clean(ex.name || 'Exercice'), nameMax)[0];
    doc.text(nm, x + pad + 11, cy + 1.6);
    var right = x + w - pad;
    if (ex.muscle) { var pw = pill(doc, ex.muscle, right, cy, C.bronze); right -= pw + 2; }
    if (ex.tag) pill(doc, ex.tag, right, cy, ex.color || C.copper);
    var yy = y + 14;
    if (ex.kind === 'sets') {
      var c0 = x + pad + 2, c1 = x + pad + 30, c2 = x + pad + 78, c3 = x + w - pad - 2;
      font(doc, 6.4, true); ink(doc, C.mute);
      tracked(doc, 'SÉRIE', c0, yy + 3.4, 0.6); tracked(doc, 'POIDS', c1, yy + 3.4, 0.6); tracked(doc, 'RÉPÉTITIONS', c2, yy + 3.4, 0.6); tracked(doc, 'VOLUME', c3, yy + 3.4, 0.6, 'right');
      stroke(doc, C.line); doc.setLineWidth(0.2); doc.line(x + pad, yy + 5.2, x + w - pad, yy + 5.2);
      yy += 7;
      (ex.sets || []).forEach(function (s, i) {
        if (i % 2 === 0) { fill(doc, C.card2); doc.rect(x + pad - 1, yy - 0.2, w - pad * 2 + 2, rowH, 'F'); }
        if (s.top) { fill(doc, C.copper); doc.rect(x + pad - 1, yy - 0.2, 1, rowH, 'F'); }
        var base = yy + 4.5;
        font(doc, 9, true); ink(doc, C.copper); doc.text(String(i + 1), c0, base);
        font(doc, 10, false); ink(doc, C.white); doc.text(dec(s.w) + ' kg', c1, base);
        doc.text(String(s.r) + ' reps', c2, base);
        font(doc, 10, true); ink(doc, s.top ? C.champ : C.dim); doc.text(num(s.v) + ' kg', c3, base, { align: 'right' });
        yy += rowH;
        if (s.note) { font(doc, 7.8, false, true); ink(doc, C.mute); doc.text('Note : ' + clean(s.note), c1, yy + 3); yy += 4.6; }
      });
      if (ex.rest || ex.total) {
        yy += 1.2;
        stroke(doc, C.line); doc.setLineWidth(0.2); doc.line(x + pad, yy, x + w - pad, yy);
        font(doc, 7.6, false); ink(doc, C.mute);
        if (ex.rest) doc.text('Repos : ' + clean(ex.rest), x + pad + 2, yy + 5);
        if (ex.total) {
          font(doc, 7.6, false); ink(doc, C.mute);
          var tv = num(ex.total) + ' kg', tl = 'VOLUME DE L’EXERCICE';
          font(doc, 9, true); var tw = textW(doc, tv);
          ink(doc, C.champ); doc.text(tv, x + w - pad - 2, yy + 5.2, { align: 'right' });
          font(doc, 6.4, true); ink(doc, C.mute); tracked(doc, tl, x + w - pad - 2 - tw - 3, yy + 5, 0.5, 'right');
        }
        yy += 8;
      }
    } else {
      var tiles = ex.tiles && ex.tiles.length ? ex.tiles : [['MESURES', '—']];
      var n = tiles.length, gap = 3.5, tw2 = (w - pad * 2 - gap * (n - 1)) / n;
      tiles.forEach(function (t, i) {
        var tx = x + pad + i * (tw2 + gap);
        fill(doc, C.card2); stroke(doc, C.line); doc.setLineWidth(0.2); doc.roundedRect(tx, yy, tw2, 16, 2, 2, 'FD');
        font(doc, 6.2, true); ink(doc, C.mute); tracked(doc, t[0].toUpperCase(), tx + 3.5, yy + 5.2, 0.5);
        font(doc, 13, true); ink(doc, C.champ); doc.text(clean(t[1]), tx + 3.5, yy + 12.4);
      });
      yy += 19;
      if (ex.rest) { font(doc, 7.6, false); ink(doc, C.mute); doc.text('Repos : ' + clean(ex.rest), x + pad + 2, yy + 2.6); yy += 6; }
    }
    if (tipLines.length) {
      font(doc, 8.6, false, true); ink(doc, C.dim);
      doc.text(tipLines, x + pad + 2, yy + 2.8);
    }
    b.y = y + h + 4.5;
  }

  /* ── bandeau de groupe (superset, tri-set, circuit abdos) ── */
  function groupLabel(b, label, color) {
    var doc = b.doc;
    b.ensure(40);
    fill(doc, color); doc.circle(M + 1.4, b.y + 2.3, 1.1, 'F');
    font(doc, 7.6, true); ink(doc, color); tracked(doc, label.toUpperCase(), M + 5, b.y + 3.2, 0.9);
    b.y += 7.5;
  }

  /* ── bloc de texte (ressenti, feedback, conseil) : carte à barre latérale colorée ── */
  function quoteCard(b, label, text, color) {
    var doc = b.doc, pad = 6;
    font(doc, 9.4, false); var lines = doc.splitTextToSize(clean(text), CW - pad * 2 - 4);
    var lineH = 4.5, maxPerPage = Math.floor((BOTTOM - 40) / lineH), chunk, first = true;
    while (lines.length) {
      chunk = lines.splice(0, Math.min(lines.length, maxPerPage - 4));
      var h = 13 + chunk.length * lineH + 3;
      b.ensure(h + 4);
      var y = b.y;
      card(doc, M, y, CW, h, 3);
      fill(doc, color); doc.roundedRect(M, y + 3, 1.6, h - 6, 0.7, 0.7, 'F');
      font(doc, 6.8, true); ink(doc, color); tracked(doc, (first ? label : label + ' (suite)').toUpperCase(), M + pad + 2, y + 7.4, 0.9);
      font(doc, 9.4, false); ink(doc, C.dim);
      chunk.forEach(function (l, i) { doc.text(l, M + pad + 2, y + 13.2 + i * lineH); });
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
    cover(b, { kind: 'FICHE DE SÉANCE', sub: 'Suivi sportif', title: s.name || 'Séance', meta: meta, kpis: kpis.slice(0, 4) });

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

  /* ───────────────────────── programme généré par IA ───────────────────────── */
  function aiProgram(jsPDF, p) {
    var b = Builder(jsPDF, 'Programme IA · À adapter avec ton coach');
    var doc = b.doc;
    var d = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    var exs = p.exercises || [];
    var kpis = [{ value: String(exs.length), unit: exs.length > 1 ? 'exercices' : 'exercice', label: 'Au programme' }];
    var nSets = exs.reduce(function (a, e) { return a + (parseInt(e.sets, 10) || 3); }, 0);
    if (exs.length) kpis.push({ value: String(nSets), unit: 'séries', label: 'Au total' });
    cover(b, { kind: 'PROGRAMME PERSONNALISÉ', sub: 'Généré par IA', title: p.name || 'Programme IA',
      meta: [p.muscles, 'Créé le ' + d].filter(Boolean).join('  ·  '), kpis: kpis });
    if (p.tip) quoteCard(b, 'Conseil du coach IA', p.tip, C.champ);
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
