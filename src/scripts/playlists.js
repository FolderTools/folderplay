// Listas de reproducción: CRUD sobre localStorage.
// Identifican canciones por ruta relativa, igual que los favoritos, para que
// sobrevivan a recargas y a reaperturas de la misma carpeta.

import { getJson, setJson } from './prefs.js';

const KEY = 'playlists';

export function getPlaylists() {
  const pls = getJson(KEY, []);
  return Array.isArray(pls) ? pls : [];
}

export function savePlaylists(pls) {
  setJson(KEY, pls);
}

export function createPlaylist(name) {
  const pls = getPlaylists();
  const pl = { id: Date.now().toString(36), name, paths: [] };
  pls.push(pl);
  savePlaylists(pls);
  return pl;
}

export function mutatePlaylist(id, fn) {
  const pls = getPlaylists();
  const pl = pls.find((p) => p.id === id);
  if (pl) {
    fn(pl);
    savePlaylists(pls);
  }
}

export function deletePlaylist(id) {
  savePlaylists(getPlaylists().filter((p) => p.id !== id));
}

// Al borrar un archivo del disco deja de existir en cualquier lista.
export function removePathFromAll(path) {
  const pls = getPlaylists();
  let changed = false;
  for (const pl of pls) {
    const next = pl.paths.filter((p) => p !== path);
    if (next.length !== pl.paths.length) {
      pl.paths = next;
      changed = true;
    }
  }
  if (changed) savePlaylists(pls);
}
