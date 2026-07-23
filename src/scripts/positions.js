// Por dónde vas en cada archivo.
//
// La posición se guarda por ruta, no solo la de lo último que sonó: es lo que
// permite tener varios libros a medias a la vez. Solo se recuerda en contenido
// largo (a partir de LONG_CONTENT), porque en canciones de tres minutos
// estorba más que ayuda.

import { getJson, setJson } from './prefs.js';
import { isOn } from './settings.js';
import { LONG_CONTENT } from './state.js';

const MAX_KEPT = 300; // el almacenamiento del navegador es finito
const MIN_SAVED = 30; // por debajo de esto no merece la pena retomar
const NEAR_END = 20;  // tan cerca del final que da igual: se da por terminado

/** @type {Object<string, [number, number]>} ruta → [segundos, guardado en ms] */
let positions = getJson('positions', {});

export const isLongTrack = (track) => (track?.duration || 0) >= LONG_CONTENT;

export const positionOf = (track) => positions[track.path]?.[0] || 0;

export const isFinished = (track) =>
  track.duration > 0 && positionOf(track) >= track.duration - NEAR_END;

// Se conservan las más recientes; el resto se olvidan
function prune() {
  const paths = Object.keys(positions);
  if (paths.length <= MAX_KEPT) return;
  paths
    .sort((a, b) => (positions[b][1] || 0) - (positions[a][1] || 0))
    .slice(MAX_KEPT)
    .forEach((path) => delete positions[path]);
}

function store(path, seconds) {
  positions[path] = [seconds, Date.now()];
  prune();
  setJson('positions', positions);
}

/** Anota dónde va la pista. Las cortas no se recuerdan. */
export function rememberPosition(track, seconds) {
  if (isLongTrack(track) && seconds > MIN_SAVED) store(track.path, seconds);
}

// Un capítulo terminado se guarda con su duración completa: así cuenta para el
// progreso del libro y no se ofrece retomarlo.
export function markFinished(track) {
  if (!track?.duration) return;
  store(track.path, track.duration);
}

/** Segundos desde los que retomar la pista, o 0 si toca empezar de cero */
export function savedPositionOf(track) {
  const saved = positionOf(track);
  if (!isOn('resume') || !isLongTrack(track) || saved < MIN_SAVED) return 0;
  // Si estaba casi al final, mejor empezar de cero
  if (track.duration && saved > track.duration - NEAR_END) return 0;
  return saved;
}

/** Suma de lo escuchado frente al total, para la barra de progreso del libro */
export function progressOf(tracks) {
  let total = 0;
  let done = 0;
  for (const track of tracks) {
    total += track.duration || 0;
    done += Math.min(positionOf(track), track.duration || 0);
  }
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}
