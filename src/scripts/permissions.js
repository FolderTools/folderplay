// Confianza antes que permisos.
//
// Cualquier aviso del navegador (elegir carpeta, permitir escritura) va
// precedido de un diálogo propio que explica qué va a pasar: el de Chrome no
// se puede modificar, así que se anticipa.
//
// Los diálogos propios resuelven su promesa **dentro** del clic del botón, y
// por eso se puede llamar a `requestPermission()` justo después del `await`
// sin perder la activación del usuario.

import { ICON } from './utils.js';
import { getPref, setPref } from './prefs.js';
import { t } from './i18n.js';
import { openDialog } from './dialog.js';
import { state } from './state.js';

const bulletsHtml = (icons, lines) =>
  `<ul class="dlg-list">${lines.map((line, i) => `<li>${ICON(icons[i % icons.length])}<span>${line}</span></li>`).join('')}</ul>`;

/**
 * Explica qué va a hacer la app antes del selector de carpeta del navegador.
 * Solo la primera vez.
 * @returns {Promise<boolean>} false si el usuario se echa atrás
 */
export async function confirmIntro() {
  if (getPref('seenIntro')) return true;
  const go = await openDialog({
    icon: 'folder',
    title: t('intro.title'),
    bodyHtml: `<p>${t('intro.lead')}</p>${bulletsHtml(['shield', 'folder', 'note', 'x'], t('intro.bullets'))}`,
    confirmText: t('intro.confirm'),
    cancelText: t('intro.cancel'),
  });
  if (go) setPref('seenIntro', '1');
  return go;
}

/** "¿Qué hacéis con mis archivos?", desde el botón de privacidad */
export function showPrivacyInfo() {
  openDialog({
    icon: 'shield',
    title: t('privacyDlg.title'),
    bodyHtml: `<p>${t('privacyDlg.lead')}</p>${bulletsHtml(['shield', 'folder', 'disc', 'x'], t('privacyDlg.bullets'))}`,
    confirmText: t('dialog.gotIt'),
    cancelText: null,
  });
}

/**
 * Permiso de escritura para editar etiquetas o borrar.
 *
 * Se pide sobre la CARPETA elegida, que es donde Chrome muestra el diálogo:
 * pedirlo sobre un archivo hijo se deniega en silencio y además consume la
 * activación del clic, así que no habría segundo intento.
 *
 * @param {import('./state.js').Track} track
 * @param {string} what Qué se va a hacer, para el texto del diálogo
 */
export async function ensureWritePermission(track, what) {
  const target = state.dirHandle || track?.handle;
  if (!target) return false;
  try {
    if (await target.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  } catch {
    return false;
  }

  const go = await openDialog({
    icon: 'shield',
    title: t('perm.title'),
    bodyHtml: `<p>${t('perm.lead', { what })}</p>${bulletsHtml(['edit', 'folder', 'shield'], t('perm.bullets'))}`,
    confirmText: t('perm.confirm'),
    cancelText: t('dialog.cancel'),
  });
  if (!go) return false;

  let granted = false;
  try {
    granted = await target.requestPermission({ mode: 'readwrite' }) === 'granted';
  } catch { /* denegado */ }

  if (!granted) {
    await openDialog({
      icon: 'shield',
      title: t('perm.deniedTitle'),
      bodyHtml: `<p>${t('perm.deniedLead')}</p>${bulletsHtml(['shield', 'folder'], t('perm.deniedBullets'))}`,
      confirmText: t('dialog.gotIt'),
      cancelText: null,
    });
  }
  return granted;
}
