// Builds index.html: one self-contained file (styles, engine, UI and mock data inlined),
// so it opens from a double-click, GitHub Pages or any static host.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stripModule = (src) => src
  .replace(/^import .*$/gm, '')
  .replace(/^export (const|function|async function|let) /gm, '$1 ');

const data = JSON.parse(read('data/mock-data.json'));
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const js = [stripModule(read('src/engine.js')), stripModule(read('src/llm.js')), stripModule(read('src/importer.js')), read('src/app.js')].join('\n');

const html = read('src/index.template.html')
  .replace('/*__CSS__*/', () => read('src/styles.css'))
  .replace('/*__DATA__*/', () => `window.MG_DATA = ${json};`)
  .replace('/*__JS__*/', () => js);

writeFileSync(new URL('../index.html', import.meta.url), html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`);
