// Audiolibros.
//
// **Un libro es una carpeta.** Se detecta sola (archivos largos o .m4b) y el
// usuario puede marcarla o desmarcarla; lo marcado manda sobre lo detectado.
// No hay libros sueltos de pistas escogidas a mano: un conjunto arbitrario de
// archivos ya es una lista de reproducción, y lo que una lista no puede dar
// —capítulos en orden, progreso del conjunto, velocidad propia— es justo lo
// que ata el libro a su carpeta.
//
// Este módulo decide qué es un libro y por dónde va; reproducir es cosa de
// app.js, que compone `nextChapter()` con la cola.

import { extOf } from './utils.js';
import { getJson, setJson } from './prefs.js';
import { t, getLang } from './i18n.js';
import { state, dirOf, groupBy, LONG_CONTENT } from './state.js';
import { isFinished } from './positions.js';

// Las marcas se guardan por biblioteca: la ruta relativa sola no vale, porque
// la carpeta raíz es "" en todas y una marca puesta en una carpeta se aplicaba
// a la siguiente que abrieras. El separador es \u0000 porque no puede aparecer
// en el nombre de una carpeta (escrito como escape: en crudo convertiría el
// archivo en binario para grep y los editores).
const libraryKey = (dir) => `${state.folderName}\u0000${dir}`;

function bookMarks() {
  const raw = getJson('books', null);
  return {
    yes: Array.isArray(raw?.yes) ? raw.yes : [],
    no: Array.isArray(raw?.no) ? raw.no : [],
  };
}

export function markBook(dir, isBook) {
  const marks = bookMarks();
  const key = libraryKey(dir);
  marks.yes = marks.yes.filter((item) => item !== key);
  marks.no = marks.no.filter((item) => item !== key);
  (isBook ? marks.yes : marks.no).push(key);
  setJson('books', marks);
}

function looksLikeBook(tracks) {
  if (tracks.some((track) => extOf(track.file.name) === 'm4b')) return true;
  const long = tracks.filter((track) => (track.duration || 0) >= LONG_CONTENT).length;
  return tracks.length >= 2 && long >= Math.ceil(tracks.length * 0.6);
}

export function bookName(dir) {
  if (!dir) return state.folderName || t('books.title');
  return dir.replace(/\/$/, '').split('/').pop();
}

// Los capítulos van por número de pista y, si no lo traen, por nombre con
// orden natural ("Capítulo 2" antes que "Capítulo 10").
export function sortChapters(tracks) {
  return [...tracks].sort((a, b) =>
    (a.track ?? 9999) - (b.track ?? 9999)
    || a.path.localeCompare(b.path, getLang(), { numeric: true, sensitivity: 'base' }));
}

/** @returns {{dir: string, name: string, tracks: import('./state.js').Track[]}[]} */
export function bookList() {
  const marks = bookMarks();
  const books = [];
  for (const [dir, tracks] of groupBy((track) => dirOf(track.path))) {
    const key = libraryKey(dir);
    if (marks.no.includes(key)) continue;
    if (!marks.yes.includes(key) && !looksLikeBook(tracks)) continue;
    books.push({ dir, name: bookName(dir), tracks: sortChapters(tracks) });
  }
  return books.sort((a, b) => a.name.localeCompare(b.name, getLang()));
}

export const hasBooks = () => bookList().length > 0;

/** Carpetas que son libros; sus archivos no aparecen entre la música */
export const bookDirs = () => new Set(bookList().map((book) => book.dir));

/** Todo lo que no es capítulo de un libro: lo que sale en Canciones y Álbumes */
export const musicTracks = () => {
  const dirs = bookDirs();
  return state.tracks.filter((track) => !dirs.has(dirOf(track.path)));
};

/** Carpeta del libro al que pertenece la pista, o null si es música */
export function bookOf(track) {
  const dir = dirOf(track.path);
  const marks = bookMarks();
  const key = libraryKey(dir);
  if (marks.no.includes(key)) return null;
  if (marks.yes.includes(key)) return dir;
  const tracks = state.tracks.filter((item) => dirOf(item.path) === dir);
  return looksLikeBook(tracks) ? dir : null;
}

// Cada libro recuerda por dónde ibas: el capítulo que escuchaste la última vez,
// no el primero sin terminar (si dejas el 1 a medias y saltas al 5, "continuar"
// tiene que llevarte al 5).
const lastChapters = () => getJson('bookLastChapter', {});

export function rememberChapter(track) {
  const dir = bookOf(track);
  if (dir == null) return;
  const map = lastChapters();
  map[libraryKey(dir)] = track.path;
  setJson('bookLastChapter', map);
}

/** Capítulo por el que seguir: el último escuchado si no terminó */
export function nextChapter(book) {
  const lastPath = lastChapters()[libraryKey(book.dir)];
  const last = lastPath ? book.tracks.find((track) => track.path === lastPath) : null;
  if (last && !isFinished(last)) return last;
  if (last) {
    // El último que oíste ya está terminado: sigue por el siguiente pendiente
    const following = book.tracks.slice(book.tracks.indexOf(last) + 1).find((track) => !isFinished(track));
    if (following) return following;
  }
  return book.tracks.find((track) => !isFinished(track)) || book.tracks[0];
}

// Cada libro recuerda su velocidad: es lo que cambia entre un narrador y otro
export const bookSpeeds = () => getJson('bookSpeedByDir', {});

export function setBookSpeed(dir, value) {
  const speeds = bookSpeeds();
  speeds[dir] = value;
  setJson('bookSpeedByDir', speeds);
}
