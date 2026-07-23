// Leer la carpeta del usuario y recordar lo leído.
//
// Aquí vive lo que habla con el disco y con IndexedDB: recorrer carpetas,
// reconocer qué archivos son audio y mantener la caché de metadatos. Todo
// devuelve datos; no pinta nada ni decide qué hacer con ellos, de eso se
// encarga app.js.
//
// **Nunca se copian archivos**: los `File` son referencias perezosas al disco.

import { extOf } from './utils.js';
import { showLoader, updateLoader, hideLoader } from './ui.js';
import { t } from './i18n.js';
import { kvGet, kvSet, coverKeyOf, loadCovers, syncCovers } from './db.js';
import { state, dirOf, AUDIO_EXT, FOLDER_ART, PARSER_VERSION, folderArtEnabled } from './state.js';

/** @typedef {{file: File, path: string, handle: FileSystemFileHandle|null}} Found */

// ---------- Caché de biblioteca ----------

// Los archivos que no cambiaron (ruta + tamaño + fecha) no se vuelven a
// analizar. `PARSER_VERSION` invalida todo cuando cambian las reglas de lectura.
export async function applyLibraryCache() {
  let lib;
  try {
    lib = await kvGet('library');
  } catch {
    return;
  }
  if (!lib?.tracks?.length || lib.v !== PARSER_VERSION) return; // se re-analiza todo
  const byPath = new Map(lib.tracks.map((r) => [r.path, r]));
  const needCovers = new Set();
  const matched = [];
  for (const track of state.tracks) {
    const row = byPath.get(track.path);
    if (row && row.size === track.file.size && row.mtime === track.file.lastModified) {
      // Las portadas heredadas de la carpeta se descartan si la opción está
      // apagada: así desaparecen las que se asignaron a canciones ajenas.
      const useArt = !!row.coverKey && (!row.artFromFolder || folderArtEnabled());
      Object.assign(track, {
        title: row.title,
        artist: row.artist,
        album: row.album,
        genre: row.genre || '',
        track: row.track,
        duration: row.duration,
        coverKey: useArt ? row.coverKey : null,
        artFromFolder: useArt && !!row.artFromFolder,
        loaded: true,
      });
      if (useArt) {
        needCovers.add(row.coverKey);
        matched.push(track);
      }
    }
  }
  if (needCovers.size) {
    try {
      const covers = await loadCovers([...needCovers]);
      for (const track of matched) {
        const blob = covers.get(track.coverKey);
        if (blob) track.picture = blob;
      }
    } catch { /* sin caché de portadas */ }
  }
}

let saveLibTimer = null;

export function scheduleSaveLibrary() {
  clearTimeout(saveLibTimer);
  saveLibTimer = setTimeout(() => {
    saveLibraryCache().catch(() => {});
  }, 1500);
}

export async function saveLibraryCache() {
  if (!state.tracks.length) return;
  const covers = new Map();
  const rows = [];
  for (const track of state.tracks) {
    let key = null;
    if (track.picture) {
      if (!track.coverKey) track.coverKey = await coverKeyOf(track.picture);
      key = track.coverKey;
      if (!covers.has(key)) covers.set(key, track.picture);
    }
    rows.push({
      path: track.path,
      size: track.file.size,
      mtime: track.file.lastModified,
      title: track.title,
      artist: track.artist,
      album: track.album,
      genre: track.genre || '',
      track: track.track,
      duration: track.duration,
      coverKey: key,
      artFromFolder: !!track.artFromFolder,
    });
  }
  await kvSet('library', { v: PARSER_VERSION, folderName: state.folderName, savedAt: Date.now(), tracks: rows });
  await syncCovers(covers);
}

// ---------- Recorrer el disco ----------

const isAudio = (name) => AUDIO_EXT.has(extOf(name));
const countProgress = (files) => {
  if (files.length % 20 === 0) updateLoader(t('loader.scanningCount', { n: files.length }));
};

/**
 * Recorre una carpeta abierta con el selector (Chromium): es la única vía que
 * deja handles reales, que son los que permiten editar y borrar después.
 * @returns {Promise<{files: Found[], art: Map<string, FileSystemFileHandle>}>}
 */
export async function scanDirectory(handle) {
  showLoader(t('loader.scanning'));
  const files = [];
  const art = new Map();
  async function walk(dir, path) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        if (isAudio(entry.name)) {
          files.push({ file: await entry.getFile(), path: path + entry.name, handle: entry });
          countProgress(files);
        } else if (FOLDER_ART.test(entry.name) && !art.has(path)) {
          art.set(path, entry);
        }
      } else if (entry.kind === 'directory') {
        await walk(entry, path + entry.name + '/');
      }
    }
  }
  try {
    await walk(handle, '');
  } catch { /* carpeta ilegible a medias: se ingiere lo encontrado */ }
  return { files, art };
}

/**
 * Carpeta elegida con `<input webkitdirectory>` (Firefox y Safari). Sin
 * handles: se puede reproducir, pero no editar ni borrar.
 * @returns {{files: Found[], art: Map<string, File>, folderName: string}}
 */
export function collectFromFileList(fileList) {
  showLoader(t('loader.preparing'));
  const files = [];
  const art = new Map();
  let folderName = '';
  for (const file of fileList) {
    const rel = file.webkitRelativePath || file.name;
    if (!isAudio(file.name)) {
      if (FOLDER_ART.test(file.name) && !art.has(dirOf(rel))) art.set(dirOf(rel), file);
      continue;
    }
    if (!folderName && rel.includes('/')) folderName = rel.split('/')[0];
    files.push({ file, path: rel, handle: null });
  }
  return { files, art, folderName };
}

/**
 * Carpeta arrastrada a la ventana. Si el navegador da un handle de directorio
 * se devuelve tal cual (`dirHandle`) para leerla por la vía buena.
 * @returns {Promise<{files: Found[], art: Map<string, File>, folderName: string, dirHandle: any}>}
 */
export async function collectFromDrop(dataTransfer) {
  showLoader(t('loader.scanning'));
  const files = [];
  const art = new Map();
  let folderName = '';

  // getAsFileSystemHandle da handles reales (permite editar y borrar) en Chromium
  if (dataTransfer.items[0]?.getAsFileSystemHandle) {
    const handles = await Promise.all([...dataTransfer.items].map((i) => i.getAsFileSystemHandle?.()));
    const dirHandle = handles.find((h) => h?.kind === 'directory');
    if (dirHandle) {
      hideLoader();
      return { files, art, folderName, dirHandle };
    }
  }

  async function walkEntry(entry, path) {
    if (entry.isFile) {
      await new Promise((resolve) => {
        entry.file((file) => {
          if (isAudio(file.name)) {
            files.push({ file, path: path + file.name, handle: null });
            countProgress(files);
          } else if (FOLDER_ART.test(file.name) && !art.has(path)) {
            art.set(path, file);
          }
          resolve();
        }, resolve);
      });
    } else if (entry.isDirectory) {
      if (!folderName) folderName = entry.name;
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
        for (const child of batch) await walkEntry(child, path + entry.name + '/');
      } while (batch.length);
    }
  }

  const entries = [...dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  for (const entry of entries) await walkEntry(entry, '');
  return { files, art, folderName, dirHandle: null };
}

/**
 * Duración de los archivos que no la traen en etiquetas (m4a, ogg…): la
 * calcula el navegador cargando solo los metadatos.
 * @param {Function} onProgress Se llama tras cada archivo resuelto
 */
export async function probeDurations(onProgress) {
  const pending = state.tracks.filter((track) => !track.duration);
  if (!pending.length) return;
  const workers = Array.from({ length: 2 }, async () => {
    while (pending.length) {
      const track = pending.shift();
      await new Promise((resolve) => {
        const url = URL.createObjectURL(track.file);
        const probe = new Audio();
        probe.preload = 'metadata';
        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          URL.revokeObjectURL(url);
          probe.src = '';
          resolve();
        };
        probe.onloadedmetadata = () => {
          if (isFinite(probe.duration)) track.duration = probe.duration;
          cleanup();
        };
        probe.onerror = cleanup;
        setTimeout(cleanup, 15000);
        probe.src = url;
      });
      onProgress();
    }
  });
  await Promise.all(workers);
  scheduleSaveLibrary();
}
