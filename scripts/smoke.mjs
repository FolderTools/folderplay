// Humo: evalúa el bundle real (el mismo que sirve Cloudflare) sobre un DOM
// de mentira. No prueba la interfaz —eso pide navegador— pero sí lo que puede
// romper un reparto en módulos: importaciones que no resuelven, ciclos que
// dejan un valor a medias y errores de zona muerta al arrancar.
//
// El truco es un Proxy que responde a cualquier cosa: así el DOM nunca es la
// causa del fallo y lo que estalle es código de la app.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', '_astro');
const bundle = readdirSync(dist).find((f) => f.endsWith('.js'));

function stub(name = 'stub') {
  const fn = function () { return stub(`${name}()`); };
  return new Proxy(fn, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => `[${name}]`;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'then') return undefined;          // no parece una promesa
      if (prop === 'length' || prop === 'size') return 0;
      if (prop === 'dataset') return {};
      if (prop === 'style') return { setProperty: () => {}, removeProperty: () => {}, getPropertyValue: () => '' };
      if (prop === 'classList') return { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
      return stub(`${name}.${String(prop)}`);
    },
    set: () => true,
    has: () => true,
    apply: () => stub(`${name}()`),
    construct: () => stub(`new ${name}`),
  });
}

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const elements = new Map();
const el = (id) => {
  if (!elements.has(id)) elements.set(id, stub(`#${id}`));
  return elements.get(id);
};

const doc = new Proxy({
  querySelector: (sel) => el(sel),
  querySelectorAll: () => [],
  getElementById: (id) => el(id),
  createElement: (tag) => stub(`<${tag}>`),
  addEventListener: () => {},
  documentElement: stub('html'),
  body: stub('body'),
  head: stub('head'),
  hidden: false,
  title: '',
  readyState: 'loading', // así no se dispara init(): solo interesa la evaluación
}, { get: (t, p) => (p in t ? t[p] : stub(`document.${String(p)}`)), set: () => true });

globalThis.window = new Proxy({
  document: doc,
  localStorage: storage,
  matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
  addEventListener: () => {},
  location: { hash: '', href: 'https://folderplay.com/', pathname: '/' },
  navigator: { language: 'es-ES', languages: ['es-ES'] },
}, { get: (t, p) => (p in t ? t[p] : stub(`window.${String(p)}`)), set: (t, p, v) => { t[p] = v; return true; } });

globalThis.document = doc;
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
// Node 22 ya define navigator/location como solo-lectura: se redefinen
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: window.location, configurable: true });
globalThis.matchMedia = window.matchMedia;
globalThis.indexedDB = stub('indexedDB');
// El <audio> captura sus listeners para poder ejercitarlos después del arranque
// (ver más abajo). Todo lo demás delega en el stub.
const audioListeners = {};
globalThis.Audio = function () {
  const base = stub('Audio');
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'addEventListener') return (type, fn) => { (audioListeners[type] ||= []).push(fn); };
      if (prop === 'removeEventListener') return (type, fn) => {
        audioListeners[type] = (audioListeners[type] || []).filter((f) => f !== fn);
      };
      return target[prop];
    },
    set: () => true,
  });
};
globalThis.Image = function () { return stub('Image'); };
globalThis.IntersectionObserver = function () { return stub('IntersectionObserver'); };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', zoom: '1' });
globalThis.createImageBitmap = async () => stub('bitmap');
globalThis.MediaMetadata = function () { return stub('MediaMetadata'); };

// data: URL para importarlo como módulo de verdad (mismo motor de ESM)
const code = readFileSync(join(dist, bundle), 'utf8');
const tmp = join(tmpdir(), 'folderplay-smoke.mjs');
writeFileSync(tmp, code, 'utf8');

// Lo que estalle después de la evaluación (init() es asíncrono) también cuenta
let late = null;
process.on('uncaughtException', (err) => { late = err; });
process.on('unhandledRejection', (err) => { late = err; });

try {
  await import(pathToFileURL(tmp).href);
  console.log(`evaluado entero: ${bundle} (${Math.round(code.length / 1024)} KB)`);
} catch (err) {
  console.log('FALLA al evaluar el bundle:');
  console.log(err.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// Deja correr el arranque asíncrono antes de dar el veredicto
await new Promise((resolve) => setTimeout(resolve, 500));
if (late) {
  console.log('FALLA durante el arranque:');
  console.log((late.stack || String(late)).split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

// Los handlers que gobiernan el paso de una pista a otra son de lo más fácil de
// romper al refactorizar (una variable que se queda sin declarar, una guarda que
// se cae) y el build no lo ve. Aquí se comprueba que están cableados y que se
// ejecutan sin lanzar con el reproductor parado (sin pista en curso): así al
// menos las guardas de estado vacío quedan cubiertas, no solo el arranque.
const requiredHandlers = ['error', 'ended', 'loadedmetadata'];
const missing = requiredHandlers.filter((type) => !(audioListeners[type]?.length));
if (missing.length) {
  console.log(`FALLA: el <audio> no tiene handler para: ${missing.join(', ')}`);
  console.log('(¿se movió o se quitó el cableado de bindEvents?)');
  process.exit(1);
}
try {
  for (const type of requiredHandlers) {
    for (const fn of audioListeners[type]) fn({});
  }
} catch (err) {
  console.log('FALLA al ejercitar los handlers de audio parados:');
  console.log((err.stack || String(err)).split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

console.log('OK: arranca y los handlers de reproducción corren sin errores');
process.exit(0);
