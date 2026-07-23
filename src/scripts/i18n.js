// Idiomas. Añadir uno nuevo = crear locales/<código>.js y registrarlo aquí
// (DICTS y LANGS); nada más depende del número de idiomas.
//
// - `t(clave, vars)` devuelve el texto; las claves que falten caen a FALLBACK.
// - El marcado estático se traduce con atributos data-i18n* (ver applyStatic).

import { getPref, setPref } from './prefs.js';
import { es } from './locales/es.js';
import { en } from './locales/en.js';

const DICTS = { es, en };
const FALLBACK = 'es';

export const LANGS = Object.keys(DICTS).map((code) => ({ code, label: DICTS[code].lang.name }));

let current = detect();

function detect() {
  const saved = getPref('lang');
  if (saved && DICTS[saved]) return saved;
  // El idioma de la página manda sobre el del navegador: quien entra en /en/
  // (o el buscador que la rastrea) debe ver la app en inglés.
  const pageLang = String(document.documentElement.lang || '').slice(0, 2).toLowerCase();
  if (DICTS[pageLang]) return pageLang;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  for (const tag of preferred) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (DICTS[code]) return code;
  }
  return FALLBACK;
}

export function getLang() {
  return current;
}

/** @returns {boolean} true si el idioma cambió (hay que repintar) */
export function setLang(code) {
  if (!DICTS[code] || code === current) return false;
  current = code;
  setPref('lang', code);
  document.documentElement.lang = code;
  applyStatic();
  return true;
}

function lookup(dict, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
}

/**
 * @param {string} key    Ruta con puntos, p. ej. 'menu.addQueue'
 * @param {Object} [vars] Sustituye {placeholders} del texto
 * @returns {string|string[]} Texto (o lista, para viñetas de diálogos)
 */
export function t(key, vars) {
  let value = lookup(DICTS[current], key);
  if (value == null) value = lookup(DICTS[FALLBACK], key);
  if (value == null) return key; // clave inexistente: se ve en pantalla y se corrige
  if (typeof value !== 'string') return value;
  return vars ? value.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m)) : value;
}

const ATTR_MAP = {
  i18nPlaceholder: 'placeholder',
  i18nTitle: 'title',
  i18nAria: 'aria-label',
};

// Traduce el HTML estático: data-i18n (texto), data-i18n-html (HTML) y
// data-i18n-placeholder / -title / -aria (atributos).
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  for (const [dataKey, attr] of Object.entries(ATTR_MAP)) {
    root.querySelectorAll(`[data-${dataKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`)
      .forEach((el) => el.setAttribute(attr, t(el.dataset[dataKey])));
  }
  document.documentElement.lang = current;
}
