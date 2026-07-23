// Preferencias del usuario en localStorage, siempre bajo el prefijo de la app.
// Módulo hoja: no importa nada. Al cargarse migra las claves del nombre
// anterior (miusic: → folderplay:) para no perder favoritos ni listas.

const PREFIX = 'folderplay:';
const LEGACY_PREFIX = 'miusic:';

(function migrateLegacyKeys() {
  try {
    if (localStorage.getItem(`${PREFIX}migrated`)) return;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(LEGACY_PREFIX)) continue;
      const next = PREFIX + key.slice(LEGACY_PREFIX.length);
      if (localStorage.getItem(next) == null) localStorage.setItem(next, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
    localStorage.setItem(`${PREFIX}migrated`, '1');
  } catch { /* almacenamiento bloqueado: se sigue sin preferencias */ }
})();

export function getPref(key, fallback = null) {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value));
  } catch { /* sin espacio o en modo privado */ }
}

export function removePref(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* nada que borrar */ }
}

export function getJson(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setJson(key, value) {
  setPref(key, JSON.stringify(value));
}
