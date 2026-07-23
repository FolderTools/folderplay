// Comprobaciones que el build no hace (no hay tipos ni tests):
//   1. Todo $('#id') del código existe en el marcado.
//   2. Toda clave de i18n usada existe en español.
//   3. Todo lo que hay en español está también en el resto de idiomas.
//   4. Ningún archivo de texto lleva bytes nulos.
//   5. Ningún módulo usa un identificador que no declara ni importa.
//   6. Ningún módulo importa de app.js (app.js es el que orquesta).
// Uso: npm run check

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { undeclaredIdentifiers, unusedImports } from './undeclared.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// Elementos que se crean con innerHTML y no están en el .astro
const DYNAMIC_IDS = new Set([
  'new-list', 'back-btn', 'play-all', 'pl-rename', 'pl-delete',
  'sort-select', 'sort-dir', 'start-select', 'goto-artist', 'art-expand',
  'settings-body', 'play-book',
]);

// El marcado vive repartido entre páginas y componentes
const markup = [
  ...readdirSync(join(root, 'src/components')).map((f) => `src/components/${f}`),
  'src/pages/index.astro',
].filter((rel) => rel.endsWith('.astro')).map(read).join('\n');
const scriptFiles = readdirSync(join(root, 'src/scripts')).filter((f) => f.endsWith('.js'));
const code = scriptFiles.map((f) => read(`src/scripts/${f}`)).join('\n');

const flat = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? flat(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]);

const { es } = await import('../src/scripts/locales/es.js');
const locales = { en: (await import('../src/scripts/locales/en.js')).en };

const usedIds = [...new Set([...code.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]))];
const missingIds = usedIds.filter((id) => !DYNAMIC_IDS.has(id) && !markup.includes(`id="${id}"`));

const esKeys = new Set(flat(es));
const usedKeys = [...new Set([
  ...[...code.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]),
  ...[...markup.matchAll(/data-i18n(?:-\w+)?="([\w.]+)"/g)].map((m) => m[1]),
])];
const missingKeys = usedKeys.filter((key) => !esKeys.has(key));

// El panel de ajustes compone sus claves (`settings.<key>`), así que se
// comprueban a partir del registro: añadir un ajuste sin textos falla aquí.
const settingsSrc = read('src/scripts/settings.js');
const settingKeys = [...settingsSrc.matchAll(/^\s*(?:\{\s*)?key: '(\w+)'/gm)].map((m) => m[1]);
const sections = (settingsSrc.match(/export const SECTIONS = \[([^\]]+)\]/)?.[1] || '')
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
const missingSettings = [
  ...settingKeys.filter((key) => !esKeys.has(`settings.${key}`)).map((key) => `settings.${key}`),
  ...sections.filter((s) => !esKeys.has(`settings.section.${s}`)).map((s) => `settings.section.${s}`),
];

// Un `\0` escrito en crudo (pasó en `libraryKey`) hace que grep, ripgrep y los
// editores traten el fuente como binario y dejen de buscar dentro, sin avisar.
// Como escape (`\u0000`) el valor es el mismo y el archivo sigue siendo texto.
const textFiles = [];
(function walk(rel) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child);
    else if (/\.(js|mjs|astro|css|md|json)$/.test(entry.name)) textFiles.push(child);
  }
})('src');
const withNul = [...textFiles, 'scripts/check.mjs', 'CLAUDE.md']
  .filter((rel) => read(rel).includes(String.fromCharCode(0)));

// Mover una función de módulo deja atrás las variables que usaba: el build no
// lo detecta (un identificador libre lo da por global) y la app muere al
// arrancar. Esto es lo que hace seguro repartir app.js.
const jsFiles = textFiles.filter((rel) => rel.endsWith('.js'));
const undeclared = jsFiles
  .map((rel) => [rel, undeclaredIdentifiers(read(rel))])
  .filter(([, names]) => names.length);

// app.js es el director: si un módulo importa de él, hay un ciclo y el orden
// de arranque pasa a depender de quién cargue primero.
const importsApp = jsFiles.filter((rel) =>
  !rel.endsWith('/app.js') && /from '\.{1,2}\/app\.js'/.test(read(rel)));

// Cualquier otro ciclo da el mismo problema: al repartir un archivo grande es
// fácil crear A→B→A sin darse cuenta, y lo que falla es un valor a medio
// inicializar en el arranque, no el build.
const graph = new Map(jsFiles.map((rel) => {
  const dir = rel.slice(0, rel.lastIndexOf('/'));
  const deps = [...read(rel).matchAll(/from '\.\/([\w-]+\.js)'/g)].map((m) => `${dir}/${m[1]}`);
  return [rel, deps.filter((dep) => jsFiles.includes(dep))];
}));

const cycles = [];
(function findCycles() {
  const state = new Map(); // 0 = en curso, 1 = terminado
  const stack = [];
  const visit = (node) => {
    if (state.get(node) === 1) return;
    if (state.get(node) === 0) {
      cycles.push([...stack.slice(stack.indexOf(node)), node].join(' → '));
      return;
    }
    state.set(node, 0);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) visit(dep);
    stack.pop();
    state.set(node, 1);
  };
  for (const node of graph.keys()) visit(node);
})();

// Un import que ya no se usa esconde de qué depende de verdad cada módulo
const unused = jsFiles
  .map((rel) => [rel, unusedImports(read(rel))])
  .filter(([, names]) => names.length);

const problems = [];
if (withNul.length) problems.push(`bytes nulos en: ${withNul.join(', ')}`);
for (const [rel, names] of undeclared) problems.push(`sin declarar en ${rel}: ${names.join(', ')}`);
for (const [rel, names] of unused) problems.push(`importado y sin usar en ${rel}: ${names.join(', ')}`);
if (importsApp.length) problems.push(`importan de app.js: ${importsApp.join(', ')}`);
for (const cycle of cycles) problems.push(`ciclo de importaciones: ${cycle}`);
if (missingIds.length) problems.push(`IDs que no existen en el marcado: ${missingIds.join(', ')}`);
if (missingKeys.length) problems.push(`claves de i18n sin definir: ${missingKeys.join(', ')}`);
if (missingSettings.length) problems.push(`ajustes sin texto: ${missingSettings.join(', ')}`);
for (const [lang, dict] of Object.entries(locales)) {
  const keys = new Set(flat(dict));
  const missing = [...esKeys].filter((key) => !keys.has(key));
  if (missing.length) problems.push(`faltan en ${lang}: ${missing.join(', ')}`);
}

if (problems.length) {
  console.error('✗ ' + problems.join('\n✗ '));
  process.exit(1);
}
console.log(`✓ ${usedIds.length} ids, ${usedKeys.length} claves de i18n y ${settingKeys.length} ajustes correctos`);
