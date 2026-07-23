// Vocabulario compartido de la app: el estado, el elemento de audio y las
// constantes que usan varios módulos.
//
// Es deliberadamente tonto: guarda datos y no toca la pantalla. Así todos los
// módulos pueden importarlo sin depender de app.js, que es quien orquesta.

import { getPref, getJson } from './prefs.js';
import { t } from './i18n.js';

export const APP_NAME = 'FolderPlay';

// Subir cuando cambie cómo se leen las etiquetas: invalida la caché para que
// las canciones ya analizadas se vuelvan a leer con las reglas nuevas.
export const PARSER_VERSION = 3;

// m4b es el formato estándar de audiolibro: mismo contenedor que m4a
export const AUDIO_EXT = new Set(['mp3', 'm4a', 'm4b', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'webm', 'aif', 'aiff']);

// Portada suelta en la carpeta, para las canciones sin carátula incrustada.
// Desactivada por defecto: en carpetas con música variada acaba poniendo la
// misma imagen a canciones que no son de ese álbum.
export const FOLDER_ART = /^(cover|folder|front|album|albumart|artwork|thumb)[^.]*\.(jpe?g|png|webp)$/i;
export const folderArtEnabled = () => getPref('folderArt', '0') === '1';

// A partir de aquí una pista se trata como contenido largo: aparecen los
// saltos de 15/30 s y se recuerda la posición archivo a archivo. Manda la
// duración, no un "modo audiolibro".
export const LONG_CONTENT = 900; // 15 minutos

// Valores que escribe metadata.js cuando el archivo no trae etiqueta. Se
// guardan así en la caché, por eso son constantes internas y solo se traducen
// al mostrarlos (dispArtist/dispAlbum).
export const UNKNOWN_ARTIST = 'Artista desconocido';
export const UNKNOWN_ALBUM = 'Álbum desconocido';

export const dispArtist = (value) => (!value || value === UNKNOWN_ARTIST ? t('unknown.artist') : value);
export const dispAlbum = (value) => (!value || value === UNKNOWN_ALBUM ? t('unknown.album') : value);

/** Carpeta que contiene la ruta, con la barra final ('' si está en la raíz) */
export const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);

/**
 * @typedef {Object} Track
 * @property {number} id            Índice en state.tracks
 * @property {File} file            Referencia perezosa al archivo en disco (no es una copia)
 * @property {FileSystemFileHandle|null} handle  Solo con showDirectoryPicker; permite editar y borrar
 * @property {string} path          Ruta relativa dentro de la carpeta (identidad estable)
 * @property {string} title
 * @property {string} artist
 * @property {string} album
 * @property {number|null} track    Nº de pista
 * @property {number|null} duration Segundos
 * @property {Blob|null} picture    Carátula embebida
 * @property {string|null} coverUrl Object URL creado bajo demanda
 * @property {string|null} coverKey Clave de la carátula en la caché
 * @property {boolean} loaded       Metadatos ya leídos (de archivo o de caché)
 */

export const state = {
  /** @type {Track[]} */
  tracks: [],
  dirHandle: null,
  folderName: '',
  view: 'songs', // songs | albums | artists | favs | playlists | books | settings
  detail: null, // { type: 'album'|'artist', key } | { type: 'playlist', id }
  search: '',
  sort: getPref('sort', 'title'),
  sortDir: getPref('sortDir', 'asc'), // asc | desc
  selectMode: false,
  /** @type {Set<number>} ids seleccionados para acciones en lote */
  selected: new Set(),
  /** @type {Map<string, FileSystemFileHandle|File>} carpeta → imagen de portada */
  folderArt: new Map(),
  queue: [],
  baseQueue: [],
  qPos: -1,
  currentId: null,
  shuffle: getPref('shuffle') === '1',
  repeat: getPref('repeat', 'off'), // off | all | one
  favs: new Set(getJson('favs', [])),
  editingId: null,
  editPicture: null,
};

// El id ES la posición en el array (lo mantiene `forgetTrack` al borrar), así
// que esto es un acceso directo, no una búsqueda.
/** @returns {Track|undefined} */
export const trackById = (id) => state.tracks[id];

/**
 * Agrupa pistas por lo que devuelva `keyFn` (álbum, artista, carpeta…).
 * @returns {Map<string, Track[]>} en orden de aparición
 */
export function groupBy(keyFn, tracks = state.tracks) {
  const map = new Map();
  for (const track of tracks) {
    const key = keyFn(track);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(track);
  }
  return map;
}

export const audio = new Audio();
const savedVolume = parseFloat(getPref('volume', '1'));
audio.volume = isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : 1;
