// Diálogos propios de la app (confirmaciones y explicación de permisos), en
// lugar de confirm()/alert() del navegador.
//
// Devuelven una promesa que se resuelve DENTRO del clic del botón: así la
// activación del usuario sigue viva y quien llama puede abrir el selector de
// carpetas o pedir permisos justo después del await.

import { $, ICON } from './utils.js';

let resolver = null;

/**
 * @param {Object} opts
 * @param {string} [opts.icon]        Nombre de icono del sprite (sin el prefijo i-)
 * @param {string} opts.title
 * @param {string} [opts.bodyHtml]    HTML de confianza: escapar antes lo que venga del usuario
 * @param {string} [opts.confirmText]
 * @param {string|null} [opts.cancelText]  null oculta el botón de cancelar
 * @param {boolean} [opts.danger]
 * @returns {Promise<boolean>}
 */
export function openDialog({
  icon = 'shield',
  title,
  bodyHtml = '',
  confirmText = 'Continuar',
  cancelText = 'Cancelar',
  danger = false,
}) {
  closeDialog(false); // por si había otro abierto
  $('#dialog-icon').innerHTML = ICON(icon);
  $('#dialog-icon').classList.toggle('danger', danger);
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = bodyHtml;

  const confirm = $('#dialog-confirm');
  confirm.textContent = confirmText;
  confirm.classList.toggle('danger', danger);

  const cancel = $('#dialog-cancel');
  cancel.hidden = !cancelText;
  if (cancelText) cancel.textContent = cancelText;

  $('#dialog').hidden = false;
  confirm.focus();
  return new Promise((resolve) => { resolver = resolve; });
}

export function closeDialog(value = false) {
  $('#dialog').hidden = true;
  const resolve = resolver;
  resolver = null;
  resolve?.(value);
}

export function isDialogOpen() {
  return !$('#dialog').hidden;
}

export function bindDialog() {
  $('#dialog-confirm').addEventListener('click', () => closeDialog(true));
  $('#dialog-cancel').addEventListener('click', () => closeDialog(false));
  $('#dialog-close').addEventListener('click', () => closeDialog(false));
  $('#dialog').addEventListener('click', (e) => {
    if (e.target === $('#dialog')) closeDialog(false);
  });
}
