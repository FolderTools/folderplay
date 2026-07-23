// Ajustes de la app.
//
// Todo sale de SETTINGS: la vista se dibuja a partir del registro y el valor
// se guarda en prefs. Añadir un ajuste = añadir una entrada aquí y sus textos
// en locales/ (`settings.<clave>` y, si hace falta, `settings.<clave>Hint`).
// No hay que tocar el HTML ni el CSS salvo que se invente un `type` nuevo.
//
// Vive dentro de la vista principal (no en un modal) para que el reproductor
// siga a la vista: al cambiar de diseño, el cambio se ve al momento.
//
// Este módulo no importa app.js: lo que necesita de la app llega en el
// contexto de initSettings (changeLang, onChange…).

import { esc, ICON } from './utils.js';
import { getPref, setPref } from './prefs.js';
import { t, LANGS, getLang } from './i18n.js';
import { toggleMenuAt } from './ui.js';

/** @type {{changeLang?: Function, onChange?: Function, action?: Function}} */
let ctx = {};
let container = null;

export const SECTIONS = ['general', 'look', 'library', 'books'];

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const secondsOption = (n) => ({ value: String(n), label: t('settings.seconds', { n }) });

export const SETTINGS = [
  {
    key: 'lang',
    section: 'general',
    type: 'select',
    options: () => LANGS.map((lang) => ({ value: lang.code, label: lang.label })),
    get: () => getLang(),
    set: (value) => ctx.changeLang?.(value),
  },
  {
    key: 'theme',
    section: 'look',
    type: 'select',
    default: 'dark',
    options: () => [
      { value: 'dark', label: t('settings.themeDark') },
      { value: 'light', label: t('settings.themeLight') },
      { value: 'auto', label: t('settings.themeAuto') },
    ],
    apply: (value) => applyTheme(value),
  },
  {
    key: 'scale',
    section: 'look',
    type: 'select',
    default: 'large',
    options: () => [
      { value: 'normal', label: t('settings.scaleNormal') },
      { value: 'large', label: t('settings.scaleLarge') },
      { value: 'huge', label: t('settings.scaleHuge') },
    ],
    apply: (value) => { document.documentElement.dataset.scale = value; },
  },
  {
    key: 'density',
    section: 'look',
    type: 'select',
    default: 'cozy',
    options: () => [
      { value: 'cozy', label: t('settings.densityCozy') },
      { value: 'compact', label: t('settings.densityCompact') },
    ],
    apply: (value) => { document.body.dataset.density = value; },
  },
  {
    key: 'skin',
    section: 'look',
    type: 'cards',
    default: 'tint',
    options: () => [
      { value: 'tint', label: t('settings.skinTint') },
      { value: 'plain', label: t('settings.skinPlain') },
      { value: 'glass', label: t('settings.skinGlass') },
      { value: 'cover', label: t('settings.skinCover') },
      { value: 'neon', label: t('settings.skinNeon') },
    ],
    apply: (value) => { document.body.dataset.skin = value; },
  },
  {
    key: 'viz',
    section: 'look',
    type: 'select',
    default: 'off',
    options: () => [
      { value: 'off', label: t('settings.vizOff') },
      { value: 'bars', label: t('settings.vizBars') },
      { value: 'mirror', label: t('settings.vizMirror') },
      { value: 'line', label: t('settings.vizLine') },
      { value: 'pulse', label: t('settings.vizPulse') },
    ],
  },
  { key: 'accent', section: 'look', type: 'toggle', default: '1' },
  { key: 'resume', section: 'library', type: 'toggle', default: '1' },
  { key: 'folderArt', section: 'library', type: 'toggle', default: '0' },
  { key: 'countPlays', section: 'library', type: 'toggle', default: '1' },
  { key: 'resetStats', section: 'library', type: 'action', danger: true },

  // Solo se muestran cuando la biblioteca tiene algún libro: quien solo escucha
  // música no necesita ver esto.
  {
    key: 'bookSpeed',
    section: 'books',
    type: 'select',
    default: '1',
    visible: () => ctx.hasBooks?.(),
    options: () => SPEED_OPTIONS.map((value) => ({
      value: String(value),
      label: value === 1 ? t('player.speedNormal') : `${value}×`,
    })),
  },
  {
    key: 'skipBack',
    section: 'books',
    type: 'select',
    default: '15',
    visible: () => ctx.hasBooks?.(),
    options: () => [10, 15, 20, 30].map(secondsOption),
  },
  {
    key: 'skipFwd',
    section: 'books',
    type: 'select',
    default: '30',
    visible: () => ctx.hasBooks?.(),
    options: () => [15, 30, 45, 60].map(secondsOption),
  },
  {
    key: 'rewindOnResume',
    section: 'books',
    type: 'select',
    default: '5',
    visible: () => ctx.hasBooks?.(),
    options: () => [
      { value: '0', label: t('settings.rewindNone') },
      ...[3, 5, 10, 15].map(secondsOption),
    ],
  },
];

const byKey = new Map(SETTINGS.map((setting) => [setting.key, setting]));

// El tema puede seguir al sistema: en ese caso hay que escuchar los cambios
let systemThemeQuery = null;

function applyTheme(value) {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
  const resolved = value === 'auto' ? (prefersLight.matches ? 'light' : 'dark') : value;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#f5f5fa' : '#0b0b10');
  if (!systemThemeQuery) {
    systemThemeQuery = prefersLight;
    systemThemeQuery.addEventListener('change', () => {
      if (getSetting('theme') === 'auto') applyTheme('auto');
    });
  }
}

export function initSettings(context) {
  ctx = context;
  migrateLegacyValues();
  applyAllSettings();
}

// El visualizador era un interruptor ('1'/'0') antes de tener modos
function migrateLegacyValues() {
  const viz = getPref('viz');
  if (viz === '1') setPref('viz', 'bars');
  else if (viz === '0') setPref('viz', 'off');
}

/**
 * Valor actual de un ajuste (siempre string). Si lo guardado no es un valor
 * válido para ese ajuste, se devuelve el de por defecto: así un dato corrupto
 * (o una clave pisada por error) no deja la opción en un estado imposible.
 */
export function getSetting(key) {
  const setting = byKey.get(key);
  if (!setting) return null;
  if (setting.get) return setting.get();
  const value = getPref(key, setting.default);
  if (setting.type === 'toggle') {
    return value === '1' || value === '0' ? value : setting.default;
  }
  if (setting.type === 'select') {
    const valid = setting.options().some((option) => String(option.value) === String(value));
    return valid ? value : setting.default;
  }
  return value;
}

export const isOn = (key) => getSetting(key) === '1';

export function applyAllSettings() {
  for (const setting of SETTINGS) {
    if (setting.apply) setting.apply(getSetting(setting.key));
  }
}

function change(setting, value) {
  if (setting.set) {
    setting.set(value);
  } else {
    setPref(setting.key, value);
    setting.apply?.(value);
  }
  ctx.onChange?.(setting.key, value);
  renderSettings(); // los valores mostrados pueden depender unos de otros
}

// ---------- Pintado ----------

function controlHtml(setting, index, value, label) {
  if (setting.type === 'toggle') {
    return `<button class="switch ${value === '1' ? 'on' : ''}" data-i="${index}"
              role="switch" aria-checked="${value === '1'}" aria-label="${label}"><i></i></button>`;
  }
  if (setting.type === 'select') {
    // Botón + menú propio en vez de <select> nativo: el desplegable del sistema
    // no se puede tematizar y desentonaba (igual que en ordenar y en idioma).
    const current = setting.options().find((option) => option.value === value);
    return `<button class="set-select" data-i="${index}" aria-label="${label}">
        <span>${esc(current ? current.label : value)}</span>${ICON('chev-down')}</button>`;
  }
  if (setting.type === 'action') {
    return `<button class="btn-ghost tiny ${setting.danger ? 'danger' : ''}" data-i="${index}">${esc(t(`settings.${setting.key}Btn`))}</button>`;
  }
  return '';
}

function rowHtml(setting, index) {
  const label = esc(t(`settings.${setting.key}`));
  const hintKey = `settings.${setting.key}Hint`;
  const hint = t(hintKey);
  const hintHtml = hint === hintKey ? '' : `<small>${esc(hint)}</small>`;
  const value = getSetting(setting.key);

  if (setting.type === 'cards') {
    return `
      <div class="set-row set-row-block">
        <div class="set-label"><b>${label}</b>${hintHtml}</div>
        <div class="skin-cards">
          ${setting.options().map((option) => `
            <button class="skin-card ${option.value === value ? 'on' : ''}" data-i="${index}" data-value="${esc(option.value)}">
              <span class="skin-preview skin-${esc(option.value)}">
                <i class="p-cover"></i><i class="p-line"></i><i class="p-dot"></i>
              </span>
              <span class="skin-name">${esc(option.label)}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  return `
    <div class="set-row">
      <div class="set-label"><b>${label}</b>${hintHtml}</div>
      ${controlHtml(setting, index, value, label)}
    </div>`;
}

/** Dibuja los ajustes dentro de un contenedor (la vista los crea al entrar) */
export function renderSettingsInto(element) {
  container = element;
  renderSettings();
}

export function renderSettings() {
  if (!container || !container.isConnected) return;
  container.innerHTML = SECTIONS.map((section) => {
    const rows = SETTINGS
      .map((setting, index) => [setting, index])
      // `visible` permite ajustes que solo aparecen cuando tienen sentido
      .filter(([setting]) => setting.section === section && (!setting.visible || setting.visible()));
    if (!rows.length) return '';
    return `
      <section class="set-section">
        <h3>${esc(t(`settings.section.${section}`))}</h3>
        ${rows.map(([setting, index]) => rowHtml(setting, index)).join('')}
      </section>`;
  }).join('');

  container.querySelectorAll('[data-i]').forEach((el) => {
    const setting = SETTINGS[Number(el.dataset.i)];
    if (setting.type === 'toggle') {
      el.addEventListener('click', () => change(setting, getSetting(setting.key) === '1' ? '0' : '1'));
    } else if (setting.type === 'select') {
      el.addEventListener('click', () => {
        const value = getSetting(setting.key);
        toggleMenuAt(el, setting.options().map((option) => ({
          icon: option.value === value ? 'check' : '',
          label: option.label,
          fn: () => change(setting, option.value),
        })), { above: false });
      });
    } else if (setting.type === 'cards') {
      el.addEventListener('click', () => change(setting, el.dataset.value));
    } else if (setting.type === 'action') {
      el.addEventListener('click', () => ctx.action?.(setting.key));
    }
  });
}
