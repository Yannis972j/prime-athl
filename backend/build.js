// Build : transpile JSX de Muscu.html avec esbuild → Muscu.app.html sans Babel
// Render lance ce script via "npm run build" avant "npm start".
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'public', 'Muscu.html');
const OUT = path.join(__dirname, 'public', 'Muscu.app.html');

const html = fs.readFileSync(SRC, 'utf8');

const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!match) {
  console.error('[build] No <script type="text/babel"> found in Muscu.html — nothing to do.');
  process.exit(0);
}

const jsx = match[1];

const result = esbuild.transformSync(jsx, {
  loader: 'jsx',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  minify: true,
  target: ['es2019', 'chrome80', 'safari14'],
  legalComments: 'none',
});

// Échapper </script> dans le code minifié pour éviter la fermeture prématurée de la balise
const safeCode = result.code.replace(/<\/script>/gi, '<\\/script>');

let output = html
  // Retire Babel CDN (plus besoin)
  .replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>/g, '')
  // Remplace le bloc JSX par du JS vanilla
  // IMPORTANT : on utilise une fonction (pas une string) pour éviter que les $ dans le JS
  // minifié soient interprétés comme des patterns de remplacement ($&, $', $` etc.)
  .replace(/<script type="text\/babel">[\s\S]*?<\/script>/, () => `<script>${safeCode}</script>`);

fs.writeFileSync(OUT, output);
const sizeKB = (output.length / 1024).toFixed(1);
console.log(`[build] OK → ${path.relative(__dirname, OUT)} (${sizeKB} kB, Babel removed)`);
