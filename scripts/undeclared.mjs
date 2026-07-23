// Busca identificadores usados pero nunca declarados ni importados.
//
// Es la red que faltaba para repartir app.js en módulos: al mover una función
// de archivo, lo que se rompe es una variable que se quedó en el de origen, y
// eso no lo ve ni el build (Rollup no se queja de un identificador libre: lo
// da por global) ni `npm run check`. Se ve en tiempo de ejecución, con la app
// ya en blanco.
//
// El análisis es a propósito grosero: se dan por buenas TODAS las
// declaraciones del archivo, sin mirar en qué ámbito están. Así puede escapar
// un caso de sombreado raro, pero nunca acusa a un nombre que sí existe, que
// es lo que haría inservible la comprobación.

import { parse } from 'acorn';

// Lo que el navegador pone y no se importa de ningún sitio
const GLOBALS = new Set([
  'globalThis', 'window', 'document', 'navigator', 'location', 'history', 'screen', 'self',
  'console', 'performance', 'crypto', 'localStorage', 'sessionStorage', 'indexedDB',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'fetch', 'matchMedia', 'getComputedStyle', 'structuredClone', 'alert', 'confirm', 'prompt',
  'innerWidth', 'innerHeight', 'devicePixelRatio', 'scrollTo', 'addEventListener',
  'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'isFinite', 'isNaN', 'parseInt', 'parseFloat', 'undefined', 'NaN', 'Infinity',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Function',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'DOMException',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect', 'Intl',
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'TextDecoder', 'TextEncoder',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'Image', 'Audio', 'AudioContext', 'MediaMetadata', 'ImageData', 'OffscreenCanvas', 'createImageBitmap',
  'Event', 'CustomEvent', 'EventTarget', 'AbortController', 'MutationObserver',
  'IntersectionObserver', 'ResizeObserver', 'HTMLElement', 'Node', 'DOMParser', 'CSS',
  'showDirectoryPicker', 'showOpenFilePicker', 'showSaveFilePicker', 'FileSystemHandle',
  'arguments', 'import', 'require', 'process',
]);

/** Recorre el árbol pasando el nodo padre y de qué propiedad cuelga */
function walk(node, visit, parent = null, key = '') {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const [prop, value] of Object.entries(node)) {
    if (prop === 'type' || prop === 'start' || prop === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit, node, prop));
    else if (value && typeof value === 'object') walk(value, visit, node, prop);
  }
}

/** Nombres que introduce un patrón de destructuring, parámetro o declaración */
function boundNames(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': out.add(node.name); break;
    case 'ObjectPattern': node.properties.forEach((p) => boundNames(p.value ?? p.argument, out)); break;
    case 'ArrayPattern': node.elements.forEach((el) => boundNames(el, out)); break;
    case 'AssignmentPattern': boundNames(node.left, out); break;
    case 'RestElement': boundNames(node.argument, out); break;
    default: break;
  }
}

/**
 * @param {string} source Código del módulo
 * @param {Set<string>} extraGlobals Nombres admitidos además de los del navegador
 * @returns {string[]} Identificadores usados que no se declaran en ninguna parte
 */
export function undeclaredIdentifiers(source, extraGlobals = new Set()) {
  return analyze(source).undeclared.filter(([name]) => !extraGlobals.has(name))
    .map(([name, line]) => `${name} (línea ${line})`);
}

/**
 * Nombres importados que el módulo ya no usa. Al repartir app.js quedan
 * muchos, y un import de más esconde de qué depende cada archivo.
 */
export function unusedImports(source) {
  return analyze(source).unused;
}

function analyze(source) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (err) {
    // Un error de sintaxis se cuenta como problema, no como caída del script:
    // así `npm run check` sigue diciendo qué archivo y qué línea.
    return { undeclared: [['no se puede analizar: ' + err.message, 0]], unused: [] };
  }
  const declared = new Set();
  const imported = new Set();
  const used = new Map(); // nombre -> línea de la primera aparición

  walk(ast, (node, parent, key) => {
    switch (node.type) {
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ImportSpecifier':
        declared.add(node.local.name);
        imported.add(node.local.name);
        return;
      case 'VariableDeclarator':
        boundNames(node.id, declared);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) declared.add(node.id.name);
        node.params?.forEach((param) => boundNames(param, declared));
        return;
      case 'CatchClause':
        boundNames(node.param, declared);
        return;
      case 'LabeledStatement':
        declared.add(node.label.name);
        return;
      default: break;
    }

    if (node.type !== 'Identifier') return;
    // Nombres que no son referencias: obj.prop, {prop: …}, break etiqueta…
    if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (parent?.type === 'Property' && key === 'key' && !parent.computed) return;
    if (parent?.type === 'MethodDefinition' && key === 'key' && !parent.computed) return;
    if (parent?.type === 'ExportSpecifier' || parent?.type === 'ImportSpecifier') return;
    if (parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') return;
    if (!used.has(node.name)) used.set(node.name, source.slice(0, node.start).split('\n').length);
  });

  return {
    undeclared: [...used].filter(([name]) => !declared.has(name) && !GLOBALS.has(name)),
    unused: [...imported].filter((name) => !used.has(name)),
  };
}
