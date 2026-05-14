// Generates icon-512.png and icon-192.png for Prime Athl PWA.
// Holographic gradient background + white dumbbell silhouette.
const fs = require('fs');
const { PNG } = require('pngjs');

function makeIcon(size, outPath) {
  const png = new PNG({ width: size, height: size });

  // Color stops along a horizontal hue band (matches app's HOLO gradient)
  const stops = [
    [255, 107,   0],  // orange   #ff6b00
    [255,  46, 154],  // pink     #ff2e9a
    [185,  77, 255],  // violet   #b94dff
    [ 77, 208, 255],  // cyan     #4dd0ff
    [  0, 255, 198],  // mint     #00ffc6
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const sampleStop = (t) => {
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    const f = seg - i;
    const a = stops[i], b = stops[i + 1];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  };

  // Dumbbell geometry (proportional)
  const cy = size / 2;
  const barH = size * 0.10;
  const barL = size * 0.20;
  const barR = size - barL;
  const weightW = size * 0.10;
  const weightH = size * 0.40;
  const innerOffset = size * 0.03;

  const inRect = (x, y, x0, y0, x1, y1, r=0) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    if (r === 0) return true;
    // rounded corner
    const cx0 = x < x0 + r ? x0 + r : (x > x1 - r ? x1 - r : x);
    const cy0 = y < y0 + r ? y0 + r : (y > y1 - r ? y1 - r : y);
    const dx = x - cx0, dy = y - cy0;
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Background : diagonal holographic gradient with vignette
      const t = (x + y) / (2 * size);                  // diagonal sweep
      const [hr, hg, hb] = sampleStop(Math.max(0, Math.min(1, t)));

      // Vignette : darken edges
      const vx = (x - size / 2) / (size / 2);
      const vy = (y - size / 2) / (size / 2);
      const vd = Math.min(1, Math.sqrt(vx * vx + vy * vy));
      const vignette = 1 - vd * 0.25;

      let r = hr * vignette;
      let g = hg * vignette;
      let b = hb * vignette;

      // Dumbbell shape (white)
      const isBar    = inRect(x, y, barL,  cy - barH/2, barR, cy + barH/2);
      const isLeftW  = inRect(x, y, barL - weightW - innerOffset, cy - weightH/2, barL - innerOffset,        cy + weightH/2, size*0.025);
      const isRightW = inRect(x, y, barR + innerOffset,           cy - weightH/2, barR + weightW + innerOffset, cy + weightH/2, size*0.025);
      const isLeftCap  = inRect(x, y, barL - weightW - innerOffset*2 - size*0.03, cy - weightH*0.35, barL - weightW - innerOffset, cy + weightH*0.35, size*0.02);
      const isRightCap = inRect(x, y, barR + weightW + innerOffset, cy - weightH*0.35, barR + weightW + innerOffset*2 + size*0.03, cy + weightH*0.35, size*0.02);

      if (isBar || isLeftW || isRightW || isLeftCap || isRightCap) {
        r = 255; g = 255; b = 255;
      }

      png.data[idx]     = Math.max(0, Math.min(255, r | 0));
      png.data[idx + 1] = Math.max(0, Math.min(255, g | 0));
      png.data[idx + 2] = Math.max(0, Math.min(255, b | 0));
      png.data[idx + 3] = 255;
    }
  }

  return new Promise((resolve) => {
    png.pack().pipe(fs.createWriteStream(outPath)).on('finish', resolve);
  });
}

(async () => {
  await makeIcon(512, 'icon-512.png');
  await makeIcon(192, 'icon-192.png');
  await makeIcon(180, 'icon-180.png');  // apple-touch-icon
  console.log('Icons generated: 180, 192, 512');
})();
