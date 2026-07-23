// Piezas de interfaz que no saben nada de música: el velo de carga, los avisos
// efímeros y el menú contextual. No dependen del estado de la app, así que
// cualquier módulo puede usarlas sin crear un ciclo.

import { $, esc, ICON } from './utils.js';

// ---------- Velo de carga ----------

export function showLoader(text) {
  $('#loader').hidden = false;
  $('#loader-text').textContent = text;
}

export function updateLoader(text) {
  $('#loader-text').textContent = text;
}

export function hideLoader() {
  $('#loader').hidden = true;
}

// ---------- Avisos efímeros ----------

let toastTimer = null;

export function showToast(text, ms = 3000) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (ms > 0) {
    toastTimer = setTimeout(hideToast, ms);
  }
}

export function hideToast() {
  const el = $('#toast');
  el.classList.remove('show');
  toastTimer = setTimeout(() => { el.hidden = true; }, 250);
}

// ---------- Menú contextual ----------

// Con `zoom` en :root, lo que se escribe en left/top se multiplica por él,
// mientras que clientX/innerWidth y getBoundingClientRect ya vienen en píxeles
// de pantalla. Sin dividir, el menú se sale por la derecha y por abajo.
export function zoomFactor() {
  const value = parseFloat(getComputedStyle(document.documentElement).zoom);
  return isFinite(value) && value > 0 ? value : 1;
}

// Botón que abrió el menú: el clic que lo abre burbujea hasta document, y sin
// esta referencia el manejador global lo cerraría en el mismo clic. Antes era
// una lista de selectores a mano y cada botón nuevo llegaba roto.
let menuAnchor = null;

/**
 * @param {{icon: string, label: string, hint?: string, danger?: boolean, fn: Function}[]} items
 * @param {HTMLElement|null} anchor Botón que lo abre, para no cerrarlo con su propio clic
 */
function renderMenu(items, anchor = null) {
  menuAnchor = anchor;
  const menu = $('#ctx-menu');
  menu.innerHTML = items
    .map((it, i) => `
      <button data-i="${i}" class="${it.danger ? 'danger' : ''}">
        ${ICON(it.icon)}
        <span class="ctx-text">
          <span class="ctx-label">${esc(it.label)}</span>
          ${it.hint ? `<span class="ctx-hint">${esc(it.hint)}</span>` : ''}
        </span>
      </button>`)
    .join('');
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      // Sin esto, el clic sigue hasta document: al reemplazarse el contenido
      // del menú, el elemento pulsado ya no está dentro y se cerraría el
      // submenú recién abierto (velocidad, temporizador…).
      e.stopPropagation();
      hideMenu();
      items[Number(btn.dataset.i)].fn();
    });
  });
  return menu;
}

function positionMenu(menu, x, y) {
  const rect = menu.getBoundingClientRect();
  const zoom = zoomFactor();
  const left = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
  menu.style.left = `${left / zoom}px`;
  menu.style.top = `${top / zoom}px`;
}

export function showMenu(x, y, items, anchor = null) {
  positionMenu(renderMenu(items, anchor), x, y);
}

// Anclado a un botón. Por defecto se despliega hacia arriba: el selector de
// idioma vive al fondo de la barra lateral y hacia abajo no hay sitio.
export function showMenuAt(anchor, items, { above = true } = {}) {
  const menu = renderMenu(items, anchor);
  const box = anchor.getBoundingClientRect();
  const y = above ? box.top - menu.getBoundingClientRect().height - 6 : box.bottom + 6;
  positionMenu(menu, box.left, y);
  anchor.classList.add('open');
}

export function toggleMenuAt(anchor, items, options) {
  if (menuIsOpen()) hideMenu();
  else showMenuAt(anchor, items, options);
}

export function menuIsOpen() {
  return !$('#ctx-menu').hidden;
}

export function hideMenu() {
  $('#ctx-menu').hidden = true;
  // El resalte se quita del botón que abrió el menú. Antes era una lista de
  // selectores a mano y cada botón nuevo se quedaba encendido para siempre.
  menuAnchor?.classList.remove('open');
  menuAnchor = null;
}

/** ¿El clic cae dentro del menú o en el botón que lo abrió? */
export function menuOwnsEvent(target) {
  return $('#ctx-menu').contains(target) || !!menuAnchor?.contains(target);
}
