// Orquestador de la app: reproducción, vistas y eventos. Es quien conoce a
// todos los módulos y los hace trabajar juntos; ninguno de ellos lo importa.
//
// state (estado y vocabulario), ui (avisos y menús), library (leer el disco),
// positions (por dónde vas en cada archivo), books (audiolibros), settings,
// playlists, viz, accent, metadata, id3-writer, db, dialog, i18n, prefs, utils.

import { $, $$, esc, ICON, fmtTime, fmtLong, normalize, setFill, shuffleArray, extOf, genArt, cleanName, processCoverImage } from './utils.js';
import { getPref, setPref, removePref, getJson, setJson } from './prefs.js';
import { t, getLang, setLang, LANGS, applyStatic } from './i18n.js';
import { kvGet, kvSet, clearFolderData } from './db.js';
import { openDialog, closeDialog, isDialogOpen, bindDialog } from './dialog.js';
import {
  showLoader, updateLoader, hideLoader, showToast,
  showMenu, showMenuAt, toggleMenuAt, menuIsOpen, hideMenu, menuOwnsEvent,
} from './ui.js';
import { initSettings, renderSettingsInto, isOn } from './settings.js';
import { getPlaylists, createPlaylist, mutatePlaylist, deletePlaylist, removePathFromAll } from './playlists.js';
import { updateAccent, resetAccent } from './accent.js';
import { startViz, stopViz, refreshVizColor } from './viz.js';
import { parseMetadata } from './metadata.js';
import { writeId3 } from './id3-writer.js';
import {
  state, audio, trackById, dirOf, groupBy, dispArtist, dispAlbum,
  APP_NAME, folderArtEnabled, UNKNOWN_ARTIST, UNKNOWN_ALBUM,
} from './state.js';
import {
  isLongTrack, positionOf, isFinished, rememberPosition, markFinished,
  savedPositionOf, progressOf,
} from './positions.js';
import {
  bookList, hasBooks, bookDirs, musicTracks, bookOf, bookName, markBook,
  nextChapter, rememberChapter, bookSpeeds, setBookSpeed,
} from './books.js';
import { confirmIntro, showPrivacyInfo, ensureWritePermission } from './permissions.js';
import {
  applyLibraryCache, scheduleSaveLibrary, scanDirectory, collectFromFileList,
  collectFromDrop, probeDurations,
} from './library.js';

let currentUrl = null;
let seeking = false;

// ---------- Carga de carpeta (solo referencias, nunca se copian archivos) ----------

async function pickFolder() {
  if (!(await confirmIntro())) return;
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      await kvSet('dirHandle', handle);
      await loadFromHandle(handle);
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  } else {
    $('#folder-input').click();
  }
}

async function reopenSaved() {
  const handle = await kvGet('dirHandle');
  if (!handle) return;
  const perm = await handle.requestPermission({ mode: 'read' });
  if (perm === 'granted') await loadFromHandle(handle);
  else showToast(t('toast.noAccess'), 4000);
}

// Quita la carpeta de la app: olvida el acceso y la caché. No toca tus archivos.
async function removeFolder() {
  const ok = await openDialog({
    icon: 'folder',
    title: t('removeFolder.title'),
    bodyHtml: `<p>${t('removeFolder.body')}</p><p class="dlg-note">${t('removeFolder.note')}</p>`,
    confirmText: t('removeFolder.confirm'),
    cancelText: t('dialog.cancel'),
  });
  if (!ok) return;

  stopPlayback();
  for (const track of state.tracks) {
    if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
  }
  state.tracks = [];
  state.dirHandle = null;
  state.folderName = '';
  state.detail = null;
  state.search = '';
  $('#search').value = '';
  removePref('folderName');
  try {
    await clearFolderData();
  } catch { /* sin IndexedDB */ }
  savedFolder = null;
  $('#reopen-folder').hidden = true;
  document.body.classList.remove('has-library');
  $('#queue-panel').classList.remove('open');
  render(); // vacía la lista anterior: si no, sus filas siguen en el DOM
  showToast(t('removeFolder.done'), 3500);
}

async function loadFromHandle(handle) {
  state.dirHandle = handle;
  const { files, art } = await scanDirectory(handle);
  await ingest(files, handle.name, art);
}

function loadFromFileList(fileList) {
  const { files, art, folderName } = collectFromFileList(fileList);
  ingest(files, folderName || 'Mi música', art);
}

async function loadFromDrop(dataTransfer) {
  const { files, art, folderName, dirHandle } = await collectFromDrop(dataTransfer);
  // Si el navegador dio un handle de directorio, se lee por la vía buena: es
  // la que deja editar y borrar después.
  if (dirHandle) {
    await kvSet('dirHandle', dirHandle);
    await loadFromHandle(dirHandle);
    return;
  }
  // Sin nada que añadir y con biblioteca ya cargada, no se toca lo que hay
  if (files.length || !state.tracks.length) await ingest(files, folderName || 'Mi música', art);
  else hideLoader();
}

async function ingest(files, folderName, art = new Map()) {
  if (!files.length) {
    hideLoader();
    showToast(t('toast.noAudio'), 4000);
    return;
  }
  stopPlayback();
  exitSelectMode();
  state.folderArt = art;
  for (const track of state.tracks) {
    if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
  }
  state.folderName = folderName;
  setPref('folderName', folderName);
  state.tracks = files.map(({ file, path, handle }, i) => ({
    id: i,
    file,
    handle,
    path,
    mtime: file.lastModified,
    title: file.name.replace(/\.[^.]+$/, ''),
    artist: '…',
    album: '…',
    genre: '',
    track: null,
    duration: null,
    picture: null,
    coverUrl: null,
    coverKey: null,
    loaded: false,
  }));
  hydrateStats();
  state.detail = null;
  state.view = 'songs';
  document.body.classList.add('has-library');
  hideLoader();
  applyHash(); // al recargar, se vuelve a la vista donde estabas
  await scanMetadata();
}

let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  setTimeout(() => {
    renderPending = false;
    render();
  }, 700);
}

async function scanMetadata() {
  try {
    await applyLibraryCache();
  } catch { /* sin caché */ }
  render();

  const pending = state.tracks.filter((track) => !track.loaded);
  const total = pending.length;
  if (total) {
    let done = 0;
    showToast(t('toast.syncing', { done: 0, total }), 0);
    const workers = Array.from({ length: 4 }, async () => {
      while (pending.length) {
        const track = pending.shift();
        const meta = await parseMetadata(track.file);
        Object.assign(track, meta, { loaded: true });
        done++;
        if (done % 10 === 0 || done === total) {
          showToast(t('toast.syncing', { done, total }), 0);
          scheduleRender();
        }
      }
    });
    await Promise.all(workers);
    render();
  }
  await applyFolderArt();
  restoreLastSession();
  showToast(t('toast.ready'), 2500);
  scheduleSaveLibrary();
  probeDurations(scheduleRender);
}

// Portada suelta en la carpeta (cover.jpg, folder.jpg…) para las canciones que
// no llevan carátula dentro del archivo. Se lee una vez por carpeta.
async function applyFolderArt() {
  if (!folderArtEnabled() || !state.folderArt.size) return;
  const loaded = new Map();
  let applied = 0;
  for (const track of state.tracks) {
    if (track.picture) continue;
    const dir = dirOf(track.path);
    const source = state.folderArt.get(dir);
    if (!source) continue;
    if (!loaded.has(dir)) {
      try {
        const file = typeof source.getFile === 'function' ? await source.getFile() : source;
        loaded.set(dir, await processCoverImage(file));
      } catch {
        loaded.set(dir, null);
      }
    }
    const blob = loaded.get(dir);
    if (!blob) continue;
    track.picture = blob;
    track.coverKey = null;
    track.artFromFolder = true; // no se incrusta en el MP3 salvo que se pida
    applied++;
  }
  if (applied) render();
}

// ---------- Reproducción ----------

// El color adaptativo se puede desactivar en Ajustes
function applyAccentFor(track) {
  if (!isOn('accent')) {
    resetAccent();
    refreshVizColor();
    return;
  }
  updateAccent(track.picture, `${track.artist}·${track.album}·${track.title}`).then(refreshVizColor);
}

function coverUrlOf(track) {
  if (track.picture && !track.coverUrl) track.coverUrl = URL.createObjectURL(track.picture);
  return track.coverUrl;
}

function artHtml(track, icon = 'note') {
  const url = coverUrlOf(track);
  return url
    ? `<img src="${url}" alt="" loading="lazy">`
    : genArt(`${track.artist}·${track.album}·${track.title}`, icon);
}

function playFromContext(id, contextIds) {
  state.baseQueue = [...contextIds];
  if (state.shuffle) {
    const rest = contextIds.filter((x) => x !== id);
    shuffleArray(rest);
    state.queue = [id, ...rest];
    state.qPos = 0;
  } else {
    state.queue = [...contextIds];
    state.qPos = state.queue.indexOf(id);
  }
  playCurrent();
}

function playCurrent() {
  const id = state.queue[state.qPos];
  const track = trackById(id);
  if (!track) return;
  savePlaybackPosition(); // guarda dónde iba la anterior antes de cambiar
  state.currentId = id;
  rememberChapter(track); // si es un libro, este pasa a ser su capítulo actual
  countedCurrentPlay = false;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(track.file);
  audio.src = currentUrl;
  applySpeed();

  // Contenido largo: se retoma donde se dejó, retrocediendo unos segundos
  // para recuperar el hilo (como hacen los reproductores de audiolibros).
  const saved = savedPositionOf(track);
  if (saved) {
    const rewind = Number(getPref('rewindOnResume', '5')) || 0;
    const resumeAt = Math.max(0, saved - rewind);
    audio.addEventListener('loadedmetadata', () => {
      try {
        audio.currentTime = resumeAt;
        showToast(t('player.resumedAt', { time: fmtTime(resumeAt) }), 2500);
      } catch { /* el navegador no pudo saltar */ }
    }, { once: true });
  }
  audio.play().catch(() => {});
  updateMediaSession(track);
  applyAccentFor(track);
  document.title = `${track.title} · ${dispArtist(track.artist)} — ${APP_NAME}`;
  renderPlayerBar();
  renderQueue();
  highlightPlaying();
  watchCurrentRow();
}

// ---------- Contenido largo: velocidad, saltos, posición y temporizador ----------
// Un capítulo de audiolibro, un directo o una mezcla necesitan otros controles
// que una canción de tres minutos. En lugar de un "modo", manda la duración:
// los saltos largos y la posición guardada se activan solos con pistas largas.

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60];

/** @type {Object<string, [number, number]>} ruta → [segundos, guardado en ms] */
let positions = getJson('positions', {});
let sleepTimer = null;
let sleepEndsAt = 0;
let sleepAtTrackEnd = false;
let sleepTick = null;

function currentSpeed() {
  const value = parseFloat(getPref('speed', '1'));
  return SPEEDS.includes(value) ? value : 1;
}

function applySpeed(value = speedForCurrent()) {
  audio.defaultPlaybackRate = value; // si no, al cargar otro archivo se pierde
  audio.playbackRate = value;
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
}

// La velocidad de un libro se guarda para ese libro (cada narrador pide la
// suya); la de la música es global.
function setSpeed(value) {
  const track = state.currentId != null ? trackById(state.currentId) : null;
  const dir = track ? bookOf(track) : null;
  if (dir != null) setBookSpeed(dir, value);
  else setPref('speed', value);
  applySpeed(value);
  renderExtras();
}

function skip(seconds) {
  if (!audio.src || !audio.duration) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
}

// Guarda dónde va lo que suena: la sesión (para "continuar" al volver a abrir)
// y, si es contenido largo, la posición de ese archivo concreto.
function savePlaybackPosition() {
  if (!isOn('resume') || state.currentId == null) return;
  const track = trackById(state.currentId);
  if (!track) return;
  lastResumeSave = audio.currentTime;
  // Ojo: la clave NO puede ser 'resume', que es el ajuste (un '1'/'0')
  setJson('lastSession', { path: track.path, time: audio.currentTime });
  rememberPosition(track, audio.currentTime);
}

// ---------- Temporizador de apagado ----------

function sleepLabel() {
  if (sleepAtTrackEnd) return t('player.sleepTrackEnd');
  if (!sleepEndsAt) return t('player.sleepOff');
  return fmtTime(Math.max(0, (sleepEndsAt - Date.now()) / 1000));
}

function cancelSleep() {
  clearTimeout(sleepTimer);
  clearInterval(sleepTick);
  sleepTimer = null;
  sleepTick = null;
  sleepEndsAt = 0;
  sleepAtTrackEnd = false;
  renderExtras();
}

function startSleep(minutes) {
  cancelSleep();
  if (minutes === 'track') {
    sleepAtTrackEnd = true;
    showToast(t('player.sleepEndSet'), 3000);
  } else {
    sleepEndsAt = Date.now() + minutes * 60000;
    sleepTimer = setTimeout(() => {
      audio.pause();
      cancelSleep();
      showToast(t('player.sleepDone'), 5000);
    }, minutes * 60000);
    sleepTick = setInterval(renderExtras, 1000);
    showToast(t('player.sleepSet', { time: fmtTime(minutes * 60) }), 3000);
  }
  renderExtras();
}

// Estado del botón de extras: insignia con la velocidad o el tiempo restante
function renderExtras() {
  const badge = $('#extras-badge');
  const speed = speedForCurrent();
  const active = sleepEndsAt || sleepAtTrackEnd;
  let text = '';
  if (active) text = sleepAtTrackEnd ? '🌙' : fmtTime(Math.max(0, (sleepEndsAt - Date.now()) / 1000));
  else if (speed !== 1) text = `${speed}×`;
  badge.textContent = text;
  badge.hidden = !text;
  $('#btn-extras').classList.toggle('on', !!text);
}

function openExtrasMenu(anchor) {
  showMenuAt(anchor, [
    {
      icon: 'speed',
      label: t('player.speed', { value: speedForCurrent() === 1 ? t('player.speedNormal') : `${speedForCurrent()}×` }),
      fn: () => openSpeedMenu(anchor),
    },
    {
      icon: 'moon',
      label: t('player.sleep', { value: sleepLabel() }),
      fn: () => openSleepMenu(anchor),
    },
  ]);
}

function openSpeedMenu(anchor) {
  showMenuAt(anchor, SPEEDS.map((value) => ({
    icon: value === speedForCurrent() ? 'check' : 'speed',
    label: value === 1 ? t('player.speedNormal') : `${value}×`,
    fn: () => setSpeed(value),
  })));
}

function openSleepMenu(anchor) {
  const items = SLEEP_MINUTES.map((minutes) => ({
    icon: 'moon',
    label: t('player.sleepMinutes', { n: minutes }),
    fn: () => startSleep(minutes),
  }));
  items.push({ icon: 'moon', label: t('player.sleepTrackEnd'), fn: () => startSleep('track') });
  if (sleepEndsAt || sleepAtTrackEnd) {
    items.push({ icon: 'x', label: t('player.sleepCancel'), danger: true, fn: cancelSleep });
  }
  showMenuAt(anchor, items);
}

function playBook(book) {
  const chapter = nextChapter(book);
  if (chapter) playFromContext(chapter.id, book.tracks.map((track) => track.id));
}

function speedForCurrent() {
  const track = state.currentId != null ? trackById(state.currentId) : null;
  const dir = track ? bookOf(track) : null;
  if (dir != null) {
    const saved = bookSpeeds()[dir];
    if (saved) return saved;
    return parseFloat(getPref('bookSpeed', '1')) || 1;
  }
  return currentSpeed();
}

// Deja una canción cargada y lista, sin reproducirla: el navegador no permite
// sonar sin un gesto del usuario, así que solo se prepara.
function prepareTrack(id, position) {
  const track = trackById(id);
  if (!track) return;
  state.queue = [id];
  state.baseQueue = [id];
  state.qPos = 0;
  state.currentId = id;
  countedCurrentPlay = true; // no cuenta como reproducción: no ha sonado
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(track.file);
  audio.src = currentUrl;
  if (position > 0) {
    audio.addEventListener('loadedmetadata', () => {
      try {
        audio.currentTime = position;
      } catch { /* el navegador no pudo saltar */ }
    }, { once: true });
  }
  updateMediaSession(track);
  applyAccentFor(track);
  renderPlayerBar();
  renderQueue();
  highlightPlaying();
}

let lastResumeSave = 0;

function restoreLastSession() {
  if (!isOn('resume')) return;
  const saved = getJson('lastSession', null);
  if (!saved?.path) return;
  const track = state.tracks.find((item) => item.path === saved.path);
  if (track) prepareTrack(track.id, saved.time || 0);
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  state.currentId = null;
  state.queue = [];
  state.qPos = -1;
  closeNowPlaying();
  resetAccent();
  watchCurrentRow(); // desconecta el observador y esconde el botón flotante
  document.title = APP_NAME;
}

// Windows bloquea el archivo mientras el <audio> lo tiene abierto: hay que
// soltarlo antes de reescribirlo o borrarlo, y reanudar después.
function releaseCurrentFile() {
  const snapshot = { pos: audio.currentTime, playing: !audio.paused };
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  return snapshot;
}

function restoreCurrentFile(file, snapshot) {
  currentUrl = URL.createObjectURL(file);
  audio.src = currentUrl;
  if (snapshot.pos > 0) {
    audio.addEventListener('loadedmetadata', () => {
      try {
        audio.currentTime = snapshot.pos;
      } catch { /* el navegador no pudo saltar */ }
    }, { once: true });
  }
  if (snapshot.playing) audio.play().catch(() => {});
}

function togglePlay() {
  if (!audio.src) {
    const ids = visibleTrackIds();
    if (ids.length) playFromContext(ids[0], ids);
    return;
  }
  if (audio.paused) audio.play();
  else audio.pause();
}

function next(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  if (state.qPos + 1 < state.queue.length) {
    state.qPos++;
    playCurrent();
  } else if (state.repeat === 'all' || !auto) {
    state.qPos = 0;
    playCurrent();
  } else {
    audio.pause();
  }
}

function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  state.qPos = state.qPos > 0 ? state.qPos - 1 : (state.repeat === 'all' ? state.queue.length - 1 : 0);
  playCurrent();
}

function addToQueue(id) {
  if (!state.queue.length) {
    playFromContext(id, [id]);
    return;
  }
  state.queue.push(id);
  state.baseQueue.push(id);
  renderQueue();
  showToast(t('toast.addedQueue'), 1800);
}

// Inserta justo después de la que suena, sin tocar el resto de la cola.
function playNext(id) {
  if (!state.queue.length) {
    playFromContext(id, [id]);
    return;
  }
  state.queue.splice(state.qPos + 1, 0, id);
  const basePos = state.baseQueue.indexOf(state.currentId);
  state.baseQueue.splice(basePos >= 0 ? basePos + 1 : state.baseQueue.length, 0, id);
  renderQueue();
  showToast(t('toast.playNext'), 1800);
}

// Solo se quitan las que aún no han sonado (offset > 0 respecto a la actual).
function removeFromQueue(offset) {
  const index = state.qPos + offset;
  if (offset <= 0 || index >= state.queue.length) return;
  const [id] = state.queue.splice(index, 1);
  const basePos = state.baseQueue.indexOf(id);
  if (basePos >= 0) state.baseQueue.splice(basePos, 1);
  renderQueue();
}

// Reordena la cola arrastrando. `fromOffset` es la posición visible que se
// arrastra y `toOffset` la posición visible ANTES de la cual cae (0 = la que
// suena, que no se mueve). Se traducen a índices de state.queue; baseQueue (el
// orden sin aleatorio) se ajusta por id para que quitar el aleatorio respete el
// nuevo orden.
function moveInQueue(fromOffset, toOffset) {
  if (fromOffset === toOffset || fromOffset <= 0 || toOffset <= 0) return;
  const from = state.qPos + fromOffset;
  let to = state.qPos + toOffset;
  if (from <= state.qPos || from >= state.queue.length) return;

  const [id] = state.queue.splice(from, 1);
  if (from < to) to -= 1; // al sacar el elemento, lo de después corre un puesto
  to = Math.max(state.qPos + 1, Math.min(to, state.queue.length));
  state.queue.splice(to, 0, id);

  // Espejo en baseQueue: se recoloca tras la misma pista que ahora le precede
  const predId = state.queue[to - 1];
  const b = state.baseQueue.indexOf(id);
  if (b >= 0) state.baseQueue.splice(b, 1);
  const bp = state.baseQueue.indexOf(predId);
  state.baseQueue.splice(bp >= 0 ? bp + 1 : state.baseQueue.length, 0, id);

  renderQueue();
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  setPref('shuffle', state.shuffle ? '1' : '0');
  if (state.queue.length && state.currentId != null) {
    if (state.shuffle) {
      const rest = state.baseQueue.filter((x) => x !== state.currentId);
      shuffleArray(rest);
      state.queue = [state.currentId, ...rest];
      state.qPos = 0;
    } else {
      state.queue = [...state.baseQueue];
      state.qPos = state.queue.indexOf(state.currentId);
    }
  }
  renderPlayerBar();
  renderQueue();
}

function cycleRepeat() {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  setPref('repeat', state.repeat);
  renderPlayerBar();
}

function toggleFav(id) {
  const track = trackById(id);
  const isFav = !state.favs.has(track.path);
  if (isFav) state.favs.add(track.path);
  else state.favs.delete(track.path);
  setJson('favs', [...state.favs]);

  // En la vista de Favoritos, quitar el corazón hace desaparecer la fila: ahí
  // sí hay que repintar la lista. En cualquier otra, basta con esa fila.
  if (state.view === 'favs' && !state.detail) {
    render();
    return;
  }
  paintFav(id, isFav);
  if (id === state.currentId) renderPlayerBar(); // el corazón de la barra y la vista grande
}

// Actualiza solo el corazón de una fila, sin reconstruir la lista.
function paintFav(id, isFav) {
  const btn = $(`.track-row[data-id="${id}"] .fav-btn`);
  if (!btn) return;
  btn.classList.toggle('is-fav', isFav);
  btn.innerHTML = ICON(isFav ? 'heart-fill' : 'heart');
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  const art = coverUrlOf(track);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: dispArtist(track.artist),
    album: dispAlbum(track.album),
    artwork: art ? [{ src: art, sizes: '512x512', type: track.picture.type }] : [],
  });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
  try {
    navigator.mediaSession.setActionHandler('seekto', (e) => {
      if (e.seekTime != null) audio.currentTime = e.seekTime;
    });
  } catch { /* no soportado */ }
}

// ---------- Navegación ----------

let pendingScrollToCurrent = false;

// Deja a la vista la canción que suena para no tener que buscarla con scroll.
function scrollCurrentIntoView(smooth = true) {
  if (state.currentId == null) return false;
  const row = $(`.track-row[data-id="${state.currentId}"]`);
  if (!row) return false;
  row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  row.classList.remove('flash');
  void row.offsetWidth; // reinicia la animación si ya estaba puesta
  row.classList.add('flash');
  return true;
}

// El botón flotante aparece solo cuando la canción en curso queda fuera de
// pantalla, y su flecha apunta hacia donde está.
let rowObserver = null;

function watchCurrentRow() {
  rowObserver?.disconnect();
  rowObserver = null;
  hideFab();
  if (state.currentId == null) return;
  const row = $(`.track-row[data-id="${state.currentId}"]`);
  if (!row) return;
  rowObserver = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) hideFab();
    else showFab(entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0));
  }, { root: $('#main-scroll'), threshold: 0.15 });
  rowObserver.observe(row);
}

function showFab(isAbove) {
  const fab = $('#goto-fab');
  fab.hidden = false;
  fab.classList.toggle('down', !isAbove);
}

function hideFab() {
  $('#goto-fab').hidden = true;
}

// ---------- Estado en el hash ----------
// Las vistas no son páginas de verdad (dependen de la carpeta local de cada
// visitante, no son indexables ni compartibles), pero sí deben responder al
// botón "atrás", que en el móvil es la forma natural de volver.

const VIEWS = new Set(['songs', 'albums', 'artists', 'favs', 'playlists', 'books', 'settings']);
let applyingHash = false;

function hashOfState() {
  if (isNowPlayingOpen()) return '#np';
  const detail = state.detail;
  if (detail?.type === 'album') return `#album/${encodeURIComponent(detail.key)}`;
  if (detail?.type === 'artist') return `#artist/${encodeURIComponent(detail.key)}`;
  if (detail?.type === 'playlist') return `#list/${encodeURIComponent(detail.id)}`;
  if (detail?.type === 'book') return `#book/${encodeURIComponent(detail.dir)}`;
  return `#${state.view}`;
}

function syncHash() {
  if (applyingHash) return;
  const next = hashOfState();
  if (next === (location.hash || '#songs')) return;
  // Sin biblioteca abierta no hay a dónde volver: no se ensucia el historial
  if (document.body.classList.contains('has-library')) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

function applyHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return;
  const slash = raw.indexOf('/');
  const kind = slash < 0 ? raw : raw.slice(0, slash);
  let value = '';
  try {
    value = slash < 0 ? '' : decodeURIComponent(raw.slice(slash + 1));
  } catch { /* hash escrito a mano */ }

  applyingHash = true;
  try {
    if (kind === 'np') {
      if (state.currentId != null) openNowPlaying();
      return;
    }
    if (isNowPlayingOpen()) closeNowPlaying();
    if (kind === 'album' && value) {
      state.view = 'albums';
      state.detail = { type: 'album', key: value };
    } else if (kind === 'artist' && value) {
      state.view = 'artists';
      state.detail = { type: 'artist', key: value };
    } else if (kind === 'list' && value) {
      state.detail = { type: 'playlist', id: value };
    } else if (kind === 'book') {
      state.view = 'books';
      state.detail = value ? { type: 'book', dir: value } : null;
    } else {
      state.view = VIEWS.has(kind) ? kind : 'songs';
      state.detail = null;
    }
    render();
  } finally {
    applyingHash = false;
  }
}

function goToView(view) {
  state.view = view;
  state.detail = null;
  pendingScrollToCurrent = true;
  render();
}

function goToAlbum(album) {
  closeNowPlaying();
  clearSearch();
  state.view = 'albums';
  state.detail = { type: 'album', key: album };
  pendingScrollToCurrent = true;
  render();
}

function goToArtist(artist) {
  closeNowPlaying();
  clearSearch();
  state.view = 'artists';
  state.detail = { type: 'artist', key: artist };
  pendingScrollToCurrent = true;
  render();
}

function clearSearch() {
  state.search = '';
  $('#search').value = '';
}

// ---------- Menús de la app (la mecánica del menú vive en ui.js) ----------

function openTrackMenu(e, id) {
  const track = trackById(id);
  const items = [
    { icon: 'queue', label: t('menu.addQueue'), fn: () => addToQueue(id) },
    { icon: 'next', label: t('menu.playNext'), fn: () => playNext(id) },
    { icon: 'check', label: t('menu.select'), fn: () => enterSelectMode(id) },
  ];

  if (state.detail?.type !== 'album') {
    items.push({ icon: 'disc', label: t('menu.viewAlbum'), fn: () => goToAlbum(track.album) });
  }
  if (state.detail?.type !== 'artist') {
    items.push({ icon: 'mic', label: t('menu.viewArtist'), fn: () => goToArtist(track.artist) });
  }

  for (const pl of getPlaylists()) {
    items.push({
      icon: 'note',
      label: t('menu.addTo', { name: pl.name }),
      fn: () => addToPlaylistWithToast(pl, track),
    });
  }
  items.push({
    icon: 'plus',
    label: t('menu.addNewList'),
    fn: () => promptName(t('name.new'), '', (name) => {
      const pl = createPlaylist(name);
      addToPlaylistWithToast(pl, track);
      render();
    }),
  });
  items.push({ icon: 'edit', label: t('menu.editTags'), fn: () => openEditor(id) });

  // Marcar la carpeta como libro (o dejar de serlo): lo que decidas manda
  // sobre la detección automática.
  // Es una acción de carpeta, no de una canción suelta: por eso el nombre
  // de la carpeta va en la etiqueta.
  const dir = dirOf(track.path);
  const folder = bookName(dir);
  const asBook = bookOf(track) != null;
  const inFolder = state.tracks.filter((item) => dirOf(item.path) === dir).length;
  items.push({
    icon: 'book',
    label: asBook ? t('books.unmark') : t('books.mark'),
    // Segunda línea: a cuántos archivos afecta y en qué carpeta. El número va
    // delante porque los nombres largos se cortan y es el dato que importa.
    hint: t(inFolder === 1 ? 'books.hintOne' : 'books.hintMany', { n: inFolder, name: folder }),
    fn: () => {
      markBook(dir, !asBook);
      showToast(asBook ? t('books.unmarked', { name: folder }) : t('books.marked', { name: folder }), 4000);
      render();
    },
  });

  if (state.detail?.type === 'playlist') {
    const plId = state.detail.id;
    items.push({
      icon: 'x',
      label: t('menu.removeFromList'),
      fn: () => {
        mutatePlaylist(plId, (pl) => {
          pl.paths = pl.paths.filter((p) => p !== track.path);
        });
        render();
      },
    });
  }
  if (canDeleteTrack(track)) {
    items.push({ icon: 'trash', label: t('menu.deleteDisk'), danger: true, fn: () => deleteTrack(id) });
  }
  showMenu(e.clientX, e.clientY, items, e.currentTarget);
}

// Menú de la cabecera móvil: carpeta y ajustes en un solo sitio.
function openHeadMenu(e) {
  const items = [
    { icon: 'folder', label: t('sidebar.changeFolder'), fn: pickFolder },
    { icon: 'trash', label: t('sidebar.removeFolder'), danger: true, fn: removeFolder },
    { icon: 'settings', label: t('settings.open'), fn: () => goToView('settings') },
  ];
  showMenu(e.clientX - 180, e.clientY + 10, items, e.currentTarget);
}

// Carpeta recordada, para poder reescribir su botón al cambiar de idioma.
let savedFolder = null;

function refreshReopenLabel() {
  const span = $('#reopen-folder span');
  if (!savedFolder) {
    span.textContent = t('welcome.reopen');
    return;
  }
  const extra = savedFolder.count ? t('welcome.songsCount', { n: savedFolder.count }) : '';
  span.textContent = t('welcome.reopenNamed', { name: savedFolder.name, extra });
}

function setLangLabels(code) {
  $('#welcome-lang-label').textContent = LANGS.find((lang) => lang.code === code).label;
}

function langItems() {
  return LANGS.map((lang) => ({
    icon: lang.code === getLang() ? 'check' : 'globe',
    label: lang.label,
    fn: () => changeLang(lang.code),
  }));
}

function changeLang(code) {
  if (!setLang(code)) return;
  setLangLabels(code);
  refreshReopenLabel();
  document.title = state.currentId != null
    ? `${trackById(state.currentId).title} · ${dispArtist(trackById(state.currentId).artist)} — ${APP_NAME}`
    : APP_NAME;
  render();
}

function addToPlaylistWithToast(pl, track) {
  let added = false;
  mutatePlaylist(pl.id, (p) => {
    if (!p.paths.includes(track.path)) {
      p.paths.push(track.path);
      added = true;
    }
  });
  showToast(added ? t('toast.addedTo', { name: pl.name }) : t('toast.alreadyIn', { name: pl.name }), 2000);
  renderNav();
}

// ---------- Modal de nombre (crear/renombrar lista) ----------

let nameCb = null;

function promptName(title, initial, cb) {
  nameCb = cb;
  $('#name-title').textContent = title;
  const input = $('#name-input');
  input.value = initial;
  $('#name-modal').hidden = false;
  input.focus();
  input.select();
}

function submitName() {
  const value = $('#name-input').value.trim();
  if (!value) return;
  const cb = nameCb;
  closeName();
  cb?.(value);
}

function closeName() {
  $('#name-modal').hidden = true;
  nameCb = null;
}

// ---------- Listas y filtros ----------

function filteredTracks() {
  // Los capítulos de un libro no son canciones: solo salen en Libros (y en
  // Favoritos o en una lista, donde estén porque tú los pusiste).
  let list = state.view === 'favs' ? [...state.tracks] : musicTracks();
  if (state.view === 'favs') list = list.filter((track) => state.favs.has(track.path));
  if (state.detail?.type === 'album') list = list.filter((track) => track.album === state.detail.key);
  if (state.detail?.type === 'artist') list = list.filter((track) => track.artist === state.detail.key);
  if (state.search) {
    const q = normalize(state.search);
    list = list.filter((track) => normalize(`${track.title} ${track.artist} ${track.album} ${track.path}`).includes(q));
  }
  if (state.detail?.type === 'album') {
    // Dentro de un álbum manda el número de pista
    list.sort((a, b) => (a.track ?? 999) - (b.track ?? 999) || a.title.localeCompare(b.title));
  } else {
    list.sort(compareTracks);
  }
  return list;
}

const NUMERIC_SORT = new Set(['duration', 'mtime', 'plays', 'lastPlayed']);

function compareTracks(a, b) {
  const key = state.sort;
  let result = NUMERIC_SORT.has(key)
    ? (a[key] || 0) - (b[key] || 0)
    : String(a[key] || '').localeCompare(String(b[key] || ''), getLang(), { sensitivity: 'base' });
  if (!result) result = a.title.localeCompare(b.title, getLang(), { sensitivity: 'base' });
  return state.sortDir === 'desc' ? -result : result;
}

function visibleTrackIds() {
  return filteredTracks().map((track) => track.id);
}

// ---------- Estadísticas de escucha ----------

// { ruta: [nº de reproducciones, última vez en ms] }. Se cuenta a los 20
// segundos: saltar de canción no debería sumar.
let stats = getJson('stats', {});
let countedCurrentPlay = false;

function hydrateStats() {
  for (const track of state.tracks) {
    const row = stats[track.path];
    track.plays = row?.[0] || 0;
    track.lastPlayed = row?.[1] || 0;
  }
}

function countPlay(track) {
  if (!track || !isOn('countPlays')) return;
  const now = Date.now();
  const plays = (stats[track.path]?.[0] || 0) + 1;
  stats[track.path] = [plays, now];
  track.plays = plays;
  track.lastPlayed = now;
  setJson('stats', stats);
}

// ---------- Selección múltiple ----------

/** ids de la lista que se está viendo, en su orden (para seleccionar rangos) */
let visibleIds = [];
let lastSelectedId = null;

function enterSelectMode(id = null) {
  state.selectMode = true;
  state.selected.clear();
  if (id != null) state.selected.add(id);
  lastSelectedId = id;
  render();
}

function exitSelectMode() {
  if (!state.selectMode) return;
  state.selectMode = false;
  state.selected.clear();
  lastSelectedId = null;
  renderSelectBar();
}

// Con Shift se selecciona el rango desde la última pulsada, como en un
// explorador de archivos.
function toggleSelected(id, extend, contextIds) {
  if (extend && lastSelectedId != null) {
    const from = contextIds.indexOf(lastSelectedId);
    const to = contextIds.indexOf(id);
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from];
      for (let i = start; i <= end; i++) state.selected.add(contextIds[i]);
    }
  } else if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  lastSelectedId = id;
  syncSelectionUI();
  renderSelectBar();
}

// Refleja state.selected en las filas ya pintadas, sin reconstruir la lista:
// una pasada de toggles de clase en vez de recrear miles de nodos.
function syncSelectionUI() {
  document.querySelectorAll('.track-row').forEach((row) => {
    const on = state.selected.has(Number(row.dataset.id));
    row.classList.toggle('selected', on);
    row.querySelector('.row-check')?.classList.toggle('on', on);
  });
}

function renderSelectBar() {
  const bar = $('#select-bar');
  bar.hidden = !state.selectMode;
  if (!state.selectMode) return;
  const count = state.selected.size;
  $('#sel-count').textContent = t('list.selected', { n: count });
  for (const id of ['#sel-edit', '#sel-queue', '#sel-playlist', '#sel-book', '#sel-delete']) {
    $(id).disabled = count === 0;
  }
  const all = visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));
  $('#sel-all').textContent = all ? t('list.selectNone') : t('list.selectAll');
}

function toggleSelectAll() {
  const all = visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));
  if (all) visibleIds.forEach((id) => state.selected.delete(id));
  else visibleIds.forEach((id) => state.selected.add(id));
  syncSelectionUI();
  renderSelectBar();
}

function selectedTracks() {
  return [...state.selected].map(trackById).filter(Boolean);
}

function queueSelected() {
  const ids = visibleIds.filter((id) => state.selected.has(id));
  if (!ids.length) return;
  if (!state.queue.length) playFromContext(ids[0], ids);
  else {
    state.queue.push(...ids);
    state.baseQueue.push(...ids);
    renderQueue();
  }
  showToast(t('toast.addedQueue'), 2000);
  exitSelectMode();
  render();
}

// Marcar libros en lote. Un libro sigue siendo una carpeta, así que lo que se
// marca son las carpetas de lo seleccionado: seleccionar una pista de cada
// subcarpeta y pulsar una vez convierte una estantería entera en libros.
// Si todo lo seleccionado ya es libro, el mismo botón lo deshace.
function markSelectionAsBooks() {
  const tracks = selectedTracks();
  if (!tracks.length) return;
  const dirs = [...new Set(tracks.map((track) => dirOf(track.path)))];
  // Por carpeta, no por pista: con "Todas" seleccionadas, preguntar pista a
  // pista releería las marcas miles de veces.
  const already = bookDirs();
  const asBooks = dirs.every((dir) => already.has(dir));
  for (const dir of dirs) markBook(dir, !asBooks);
  showToast(dirs.length === 1
    ? t(asBooks ? 'books.unmarked' : 'books.marked', { name: bookName(dirs[0]) })
    : t(asBooks ? 'books.unmarkedFolders' : 'books.markedFolders', { n: dirs.length }), 4000);
  exitSelectMode();
  render();
}

function playlistMenuForSelection(anchor) {
  const tracks = selectedTracks();
  const items = getPlaylists().map((pl) => ({
    icon: 'note',
    label: t('menu.addTo', { name: pl.name }),
    fn: () => {
      mutatePlaylist(pl.id, (p) => {
        for (const track of tracks) if (!p.paths.includes(track.path)) p.paths.push(track.path);
      });
      showToast(t('toast.addedTo', { name: pl.name }), 2000);
      exitSelectMode();
      render();
    },
  }));
  items.push({
    icon: 'plus',
    label: t('menu.addNewList'),
    fn: () => promptName(t('name.new'), '', (name) => {
      const pl = createPlaylist(name);
      mutatePlaylist(pl.id, (p) => { p.paths = tracks.map((track) => track.path); });
      showToast(t('toast.addedTo', { name }), 2000);
      exitSelectMode();
      render();
    }),
  });
  showMenuAt(anchor, items);
}

async function deleteSelected() {
  const tracks = selectedTracks().filter(canDeleteTrack);
  if (!tracks.length) {
    showToast(t('del.noHandle'), 4500);
    return;
  }
  const ok = await openDialog({
    icon: 'trash',
    danger: true,
    title: t('del.manyTitle', { n: tracks.length }),
    bodyHtml: `<p>${esc(t('del.manyBody', { n: tracks.length }))}</p>
      <p class="dlg-note">${esc(t('del.warn'))}</p>`,
    confirmText: t('del.confirm'),
    cancelText: t('dialog.cancel'),
  });
  if (!ok) return;
  if (!(await ensureWritePermission(tracks[0], t('perm.whatDelete')))) return;

  const currentTrack = state.currentId != null ? trackById(state.currentId) : null;
  const hitsCurrent = currentTrack && tracks.includes(currentTrack);
  if (hitsCurrent) releaseCurrentFile();

  let done = 0;
  showLoader(t('batch.progress', { done: 0, total: tracks.length }));
  for (const track of tracks) {
    try {
      const dir = await parentDirOf(track);
      await dir.removeEntry(track.path.split('/').pop());
      forgetTrack(track);
      done++;
    } catch (e) {
      console.error(e);
    }
    updateLoader(t('batch.progress', { done, total: tracks.length }));
  }
  hideLoader();

  if (hitsCurrent) {
    if (state.qPos >= 0 && state.qPos < state.queue.length) playCurrent();
    else stopPlayback();
  }
  exitSelectMode();
  render();
  scheduleSaveLibrary();
  showToast(t('del.manyDone', { n: done }), 3500);
}

// ---------- Edición por lotes ----------

let batchTracks = [];

function openBatchEditor() {
  const tracks = selectedTracks();
  if (!tracks.length) return;
  batchTracks = tracks.filter(canWriteTrack);
  const skipped = tracks.length - batchTracks.length;

  $('#batch-title').textContent = t('batch.title', { n: tracks.length });
  $('#batch-artist').value = '';
  $('#batch-album').value = '';
  $('#batch-genre').value = '';
  $('#batch-clean').checked = false;
  fillGenreList();
  $('#batch-warn').hidden = !skipped;
  if (skipped) $('#batch-warn-text').textContent = t('batch.skipped', { n: skipped });
  const save = $('#batch-save');
  save.textContent = t('batch.save', { n: batchTracks.length });
  save.disabled = !batchTracks.length;
  $('#batch-modal').hidden = false;
}

function closeBatchEditor() {
  $('#batch-modal').hidden = true;
  batchTracks = [];
}

async function saveBatch() {
  const artist = $('#batch-artist').value.trim();
  const album = $('#batch-album').value.trim();
  const genre = $('#batch-genre').value.trim();
  const clean = $('#batch-clean').checked;
  if (!artist && !album && !genre && !clean) {
    showToast(t('batch.nothing'), 3000);
    return;
  }
  const targets = batchTracks;
  if (!targets.length) return;
  if (!(await ensureWritePermission(targets[0], t('perm.whatSave')))) return;

  closeBatchEditor();
  const currentTrack = state.currentId != null ? trackById(state.currentId) : null;
  const hitsCurrent = currentTrack && targets.includes(currentTrack);
  const playback = hitsCurrent ? releaseCurrentFile() : null;

  let done = 0;
  let errors = 0;
  showLoader(t('batch.progress', { done: 0, total: targets.length }));
  for (const track of targets) {
    try {
      const title = clean ? cleanName(track.title) : track.title;
      const nextArtist = clean && !artist ? cleanName(track.artist) : (artist || track.artist);
      const nextAlbum = clean && !album ? cleanName(track.album) : (album || track.album);
      const nextGenre = genre || track.genre || '';
      await writeId3(track.file, track.handle, {
        title,
        artist: nextArtist === UNKNOWN_ARTIST ? '' : nextArtist,
        album: nextAlbum === UNKNOWN_ALBUM ? '' : nextAlbum,
        genre: nextGenre,
        track: track.track,
        // La portada de la carpeta no se incrusta: solo se conserva la propia
        picture: track.artFromFolder ? null : track.picture,
      });
      const file = await track.handle.getFile();
      Object.assign(track, {
        file,
        title,
        artist: nextArtist,
        album: nextAlbum,
        genre: nextGenre,
        mtime: file.lastModified,
      });
      done++;
    } catch (e) {
      console.error(e);
      errors++;
    }
    updateLoader(t('batch.progress', { done: done + errors, total: targets.length }));
  }
  hideLoader();

  if (hitsCurrent) {
    restoreCurrentFile(currentTrack.file, playback);
    updateMediaSession(currentTrack);
  }
  exitSelectMode();
  render();
  scheduleSaveLibrary();
  showToast(errors ? t('batch.withErrors', { n: done, errors }) : t('batch.done', { n: done }), 4000);
}

// ---------- Render ----------

function render() {
  renderNav();
  renderMain();
  renderPlayerBar();
  renderQueue();
  renderSelectBar();
  syncHash();
}

function renderNav() {
  document.body.dataset.view = state.view; // lo usa el CSS (ancho de Ajustes)
  // La sección Libros solo existe si hay libros: quien solo tiene música no
  // ve nada nuevo.
  const showBooks = hasBooks();
  $$('[data-view="books"]').forEach((btn) => { btn.hidden = !showBooks; });
  $$('.nav-btn, .tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === state.view && !state.detail);
  });
  $('#folder-name').textContent = state.folderName || '';

  const pls = getPlaylists();
  const plList = $('#pl-list');
  plList.innerHTML = pls.length
    ? pls.map((pl) => `
        <button class="pl-item ${state.detail?.type === 'playlist' && state.detail.id === pl.id ? 'active' : ''}" data-pl="${pl.id}">
          ${ICON('queue')}<span>${esc(pl.name)}</span>
        </button>`).join('')
    : `<div class="pl-empty">${esc(t('sidebar.noLists'))}</div>`;
  plList.querySelectorAll('.pl-item').forEach((btn) => {
    btn.addEventListener('click', () => openPlaylist(btn.dataset.pl));
  });
}

function openPlaylist(id) {
  state.detail = { type: 'playlist', id };
  render();
  $('#main-scroll').scrollTop = 0;
}

function viewTitle() {
  return {
    songs: t('nav.songs'),
    albums: t('nav.albums'),
    artists: t('nav.artists'),
    favs: t('nav.favs'),
    playlists: t('nav.playlists'),
    books: t('books.title'),
    settings: t('settings.title'),
  }[state.view];
}

function bindTrackRows(main, list) {
  const contextIds = list.map((track) => track.id);
  visibleIds = contextIds;
  main.querySelectorAll('.track-row').forEach((row) => {
    const id = Number(row.dataset.id);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn') || e.target.closest('.row-more')) return;
      if (state.selectMode) {
        toggleSelected(id, e.shiftKey, contextIds);
        return;
      }
      if (state.currentId === id) togglePlay();
      else playFromContext(id, contextIds);
    });
    row.querySelector('.fav-btn').addEventListener('click', () => toggleFav(id));
    row.querySelector('.row-more').addEventListener('click', (e) => openTrackMenu(e, id));
  });
}

const SORT_KEYS = [
  ['title', 'list.sortTitle'],
  ['artist', 'list.sortArtist'],
  ['album', 'list.sortAlbum'],
  ['genre', 'list.sortGenre'],
  ['duration', 'list.sortDuration'],
  ['mtime', 'list.sortDate'],
  ['plays', 'list.sortPlays'],
  ['lastPlayed', 'list.sortRecent'],
];

// Criterios donde lo natural es empezar por lo más alto o lo más reciente
const DESC_BY_DEFAULT = new Set(['plays', 'lastPlayed', 'mtime']);

// "Ascendente" no dice nada por sí solo: ¿la canción más corta o la más larga?
// Cada criterio nombra sus dos extremos, en orden [ascendente, descendente].
const SORT_DIR_LABELS = {
  duration: ['list.sortShort', 'list.sortLong'],
  mtime: ['list.sortOld', 'list.sortNew'],
  lastPlayed: ['list.sortOld', 'list.sortNew'],
  plays: ['list.sortLess', 'list.sortMore'],
};
// Los criterios de texto (título, artista, álbum, género) comparten el suyo
const TEXT_DIR_LABELS = ['list.sortAZ', 'list.sortZA'];

const sortName = (key) => t(SORT_KEYS.find(([item]) => item === key)?.[1] ?? 'list.sortTitle');

function sortDirName() {
  const pair = SORT_DIR_LABELS[state.sort] ?? TEXT_DIR_LABELS;
  return t(pair[state.sortDir === 'desc' ? 1 : 0]);
}

function setSort(key) {
  state.sort = key;
  setPref('sort', key);
  if (DESC_BY_DEFAULT.has(key)) {
    state.sortDir = 'desc';
    setPref('sortDir', 'desc');
  }
  render();
}

function listTools(list, showSort) {
  const desc = state.sortDir === 'desc';
  return `
    <div class="list-tools">
      <div class="list-tools-left">
        <span class="track-count">${t('list.count', { n: list.length })}</span>
        ${list.length && !state.selectMode
          ? `<button class="btn-ghost tiny" id="start-select">${ICON('check')} ${esc(t('list.select'))}</button>`
          : ''}
      </div>
      ${showSort ? `
        <div class="sort-tools">
          <button class="sort-pick" id="sort-select">
            <span class="sort-pick-label">${esc(t('list.sort'))}</span>
            <span class="sort-pick-value">${esc(sortName(state.sort))}</span>
            ${ICON('chev-down')}
          </button>
          <button class="sort-dir ${desc ? 'desc' : ''}" id="sort-dir"
                  title="${esc(t(desc ? 'list.sortDesc' : 'list.sortAsc'))}">
            ${ICON('arrow-up')}<span>${esc(sortDirName())}</span>
          </button>
        </div>` : ''}
    </div>`;
}

// Tras pintar: o se va a la canción que suena (si se pidió) o se sube arriba.
function applyPendingScroll() {
  if (!pendingScrollToCurrent) return;
  pendingScrollToCurrent = false;
  if (!scrollCurrentIntoView(false)) $('#main-scroll').scrollTop = 0;
}

// Pinta la vista y, pase por la rama que pase, deja siempre el mismo estado:
// scroll pendiente resuelto y vigilancia de la fila en curso reiniciada. Si
// esto se hiciera dentro de cada rama, las vistas sin lista (álbumes, artistas)
// se dejarían el observador anterior vivo y el botón flotante colgado.
function renderMain() {
  renderView();
  applyPendingScroll();
  watchCurrentRow();
}

function renderView() {
  const main = $('#view');
  const back = state.detail
    ? `<button class="back-btn" id="back-btn">${ICON('back')} ${esc(t('list.back'))}</button>`
    : '';

  if (!state.detail && state.view === 'albums') {
    const albums = [...groupBy((track) => track.album, musicTracks()).entries()]
      .filter(([key]) => !state.search || normalize(key).includes(normalize(state.search)))
      .sort((a, b) => a[0].localeCompare(b[0], 'es'));
    main.innerHTML = `
      <h1 class="view-title">${esc(t('nav.albums'))}</h1>
      <div class="card-grid">
        ${albums.map(([album, tracks]) => {
          const artists = [...new Set(tracks.map((track) => track.artist))];
          const artist = artists.length > 2 ? t('detail.various') : artists.map(dispArtist).join(', ');
          const withArt = tracks.find((track) => track.picture);
          const cover = withArt ? coverUrlOf(withArt) : null;
          return `
            <button class="card" data-album="${esc(album)}">
              <div class="card-art">${cover ? `<img src="${cover}" alt="" loading="lazy">` : genArt(`${artist}·${album}`, 'disc')}</div>
              <div class="card-name">${esc(dispAlbum(album))}</div>
              <div class="card-sub">${esc(artist)} · ${t('list.count', { n: tracks.length })}</div>
            </button>`;
        }).join('')}
      </div>`;
    main.querySelectorAll('[data-album]').forEach((el) => {
      el.addEventListener('click', () => {
        state.detail = { type: 'album', key: el.dataset.album };
        pendingScrollToCurrent = true;
        render();
      });
    });
    return;
  }

  if (!state.detail && state.view === 'artists') {
    const artists = [...groupBy((track) => track.artist, musicTracks()).entries()]
      .filter(([key]) => !state.search || normalize(key).includes(normalize(state.search)))
      .sort((a, b) => a[0].localeCompare(b[0], 'es'));
    main.innerHTML = `
      <h1 class="view-title">${esc(t('nav.artists'))}</h1>
      <div class="card-grid">
        ${artists.map(([artist, tracks]) => {
          const withArt = tracks.find((track) => track.picture);
          const cover = withArt ? coverUrlOf(withArt) : null;
          return `
            <button class="card" data-artist="${esc(artist)}">
              <div class="card-art round">${cover ? `<img src="${cover}" alt="" loading="lazy">` : genArt(artist, 'mic')}</div>
              <div class="card-name">${esc(dispArtist(artist))}</div>
              <div class="card-sub">${t('list.count', { n: tracks.length })}</div>
            </button>`;
        }).join('')}
      </div>`;
    main.querySelectorAll('[data-artist]').forEach((el) => {
      el.addEventListener('click', () => {
        state.detail = { type: 'artist', key: el.dataset.artist };
        pendingScrollToCurrent = true;
        render();
      });
    });
    return;
  }

  // Libros: cada carpeta es un libro, con su progreso
  if (!state.detail && state.view === 'books') {
    const books = bookList();
    main.innerHTML = `
      <h1 class="view-title">${esc(t('books.title'))}</h1>
      ${books.length ? `
        <div class="card-grid">
          ${books.map((book) => {
            const { total, done, percent } = progressOf(book.tracks);
            const withArt = book.tracks.find((track) => track.picture);
            const cover = withArt ? coverUrlOf(withArt) : null;
            const status = percent === 0 ? t('books.notStarted')
              : percent >= 99 ? t('books.finished')
              : t('books.progress', { percent, left: fmtLong(total - done) });
            return `
              <button class="card" data-book="${esc(book.dir)}">
                <div class="card-art">${cover ? `<img src="${cover}" alt="" loading="lazy">` : genArt(book.name, 'book')}</div>
                <div class="card-name">${esc(book.name)}</div>
                <div class="card-sub">${esc(book.tracks.length === 1
                  ? t('books.oneChapter') : t('books.chapters', { n: book.tracks.length }))} · ${esc(fmtLong(total))}</div>
                <div class="book-bar"><i style="width:${percent}%"></i></div>
                <div class="card-sub">${esc(status)}</div>
              </button>`;
          }).join('')}
        </div>`
        : `<div class="empty">${esc(t('books.empty'))}</div>`}`;
    main.querySelectorAll('[data-book]').forEach((el) => {
      el.addEventListener('click', () => {
        state.detail = { type: 'book', dir: el.dataset.book };
        render();
        $('#main-scroll').scrollTop = 0;
      });
    });
    return;
  }

  // Un libro: cabecera con progreso y sus capítulos en orden
  if (state.detail?.type === 'book') {
    const book = bookList().find((item) => item.dir === state.detail.dir);
    if (!book) {
      state.detail = null;
      renderView();
      return;
    }
    const { total, done, percent } = progressOf(book.tracks);
    const chapter = nextChapter(book);
    const chapterPos = chapter ? positionOf(chapter) : 0;
    const withArt = book.tracks.find((track) => track.picture);
    const cover = withArt ? coverUrlOf(withArt) : null;
    main.innerHTML = `
      ${back}
      <div class="detail-header">
        <div class="detail-art">${cover ? `<img src="${cover}" alt="">` : genArt(book.name, 'book')}</div>
        <div class="detail-info">
          <div class="detail-kind">${esc(t('books.title'))}</div>
          <h1 class="detail-title">${esc(book.name)}</h1>
          <div class="detail-sub">${esc(book.tracks.length === 1
            ? t('books.oneChapter') : t('books.chapters', { n: book.tracks.length }))} · ${esc(fmtLong(total))}</div>
          <div class="book-bar wide"><i style="width:${percent}%"></i></div>
          <div class="detail-actions">
            <button class="btn-primary" id="play-book">${ICON('play')} ${esc(chapterPos > 30
              ? t('books.continueAt', { time: fmtTime(chapterPos) })
              : t('books.start'))}</button>
          </div>
        </div>
      </div>
      ${listTools(book.tracks, false)}
      <div class="track-list" role="list">${book.tracks.map((track, i) => trackRow(track, i)).join('')}</div>`;
    $('#back-btn')?.addEventListener('click', leaveDetail);
    $('#play-book').addEventListener('click', () => playBook(book));
    bindListEvents(main, book.tracks);
    return;
  }

  // Ajustes: es una vista, no un modal, para que el reproductor siga visible
  // mientras se prueban los diseños.
  if (!state.detail && state.view === 'settings') {
    main.innerHTML = `
      <h1 class="view-title">${esc(t('settings.title'))}</h1>
      <div class="settings-view" id="settings-body"></div>`;
    renderSettingsInto($('#settings-body'));
    return;
  }

  // Todas las listas de reproducción (pestaña "Listas", sobre todo en móvil)
  if (!state.detail && state.view === 'playlists') {
    const pls = getPlaylists();
    main.innerHTML = `
      <h1 class="view-title">${esc(t('nav.playlists'))}</h1>
      <div class="view-actions">
        <button class="btn-ghost" id="new-list">${ICON('plus')} ${esc(t('sidebar.newList'))}</button>
      </div>
      ${pls.length ? `
        <div class="card-grid">
          ${pls.map((pl) => `
            <button class="card" data-pl="${pl.id}">
              <div class="card-art">${genArt(pl.name, 'queue')}</div>
              <div class="card-name">${esc(pl.name)}</div>
              <div class="card-sub">${t('list.count', { n: pl.paths.length })}</div>
            </button>`).join('')}
        </div>` : `<div class="empty">${esc(t('list.noLists'))}</div>`}`;
    $('#new-list').addEventListener('click', () => {
      promptName(t('name.new'), '', (name) => {
        createPlaylist(name);
        render();
      });
    });
    main.querySelectorAll('[data-pl]').forEach((el) => {
      el.addEventListener('click', () => openPlaylist(el.dataset.pl));
    });
    return;
  }

  // Vista de una lista de reproducción
  if (state.detail?.type === 'playlist') {
    const pl = getPlaylists().find((p) => p.id === state.detail.id);
    if (!pl) {
      state.detail = null;
      renderView();
      return;
    }
    const byPath = new Map(state.tracks.map((track) => [track.path, track]));
    let list = pl.paths.map((path) => byPath.get(path)).filter(Boolean);
    if (state.search) {
      const q = normalize(state.search);
      list = list.filter((track) => normalize(`${track.title} ${track.artist} ${track.album}`).includes(q));
    }
    main.innerHTML = `
      ${back}
      ${renderPlaylistHeader(pl, list)}
      ${listTools(list, false)}
      ${list.length
        ? `<div class="track-list" role="list">${list.map((track, i) => trackRow(track, i)).join('')}</div>`
        : `<div class="empty">${esc(t('list.emptyList'))}</div>`}
    `;
    $('#back-btn')?.addEventListener('click', leaveDetail);
    $('#play-all')?.addEventListener('click', () => {
      const ids = list.map((track) => track.id);
      if (ids.length) playFromContext(ids[0], ids);
    });
    $('#pl-rename')?.addEventListener('click', () => {
      promptName(t('name.rename'), pl.name, (name) => {
        mutatePlaylist(pl.id, (p) => { p.name = name; });
        render();
      });
    });
    $('#pl-delete')?.addEventListener('click', async () => {
      const ok = await openDialog({
        icon: 'trash',
        danger: true,
        title: t('listDelete.title', { name: pl.name }),
        bodyHtml: `<p>${esc(t('listDelete.body'))}</p>`,
        confirmText: t('listDelete.confirm'),
        cancelText: t('dialog.cancel'),
      });
      if (!ok) return;
      deletePlaylist(pl.id);
      state.detail = null;
      render();
    });
    bindListEvents(main, list);
    return;
  }

  // Listas de canciones (Canciones, Favoritos, detalle de álbum/artista)
  const list = filteredTracks();
  const header = state.detail
    ? renderDetailHeader(list)
    : `<h1 class="view-title">${esc(viewTitle())}</h1>`;

  main.innerHTML = `
    ${back}
    ${header}
    ${listTools(list, !state.detail)}
    ${list.length ? `
      <div class="track-list" role="list">
        ${list.map((track, i) => trackRow(track, i)).join('')}
      </div>` : `
      <div class="empty">${esc(state.view === 'favs' && !state.search ? t('list.emptyFavs') : t('list.empty'))}</div>`}
  `;

  $('#back-btn')?.addEventListener('click', leaveDetail);
  $('#play-all')?.addEventListener('click', () => {
    const ids = list.map((track) => track.id);
    if (ids.length) playFromContext(ids[0], ids);
  });
  $('#goto-artist')?.addEventListener('click', () => goToArtist(state.detail.key));

  bindListEvents(main, list);
}

function bindListEvents(main, list) {
  bindTrackRows(main, list);
  highlightPlaying();
  $('#start-select')?.addEventListener('click', () => enterSelectMode());
  // Menú propio en vez de un <select> nativo: el desplegable del sistema no se
  // puede tematizar y desentonaba con el resto (mismo motivo que en idioma).
  $('#sort-select')?.addEventListener('click', (e) => {
    toggleMenuAt(e.currentTarget, SORT_KEYS.map(([key, label]) => ({
      icon: state.sort === key ? 'check' : 'sort',
      label: t(label),
      fn: () => setSort(key),
    })), { above: false });
  });
  $('#sort-dir')?.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    setPref('sortDir', state.sortDir);
    render();
  });
}

function leaveDetail() {
  state.detail = null;
  pendingScrollToCurrent = true;
  render();
}

function renderDetailHeader(list) {
  const isAlbum = state.detail.type === 'album';
  const withArt = list.find((track) => track.picture) || list[0];
  const artists = [...new Set(list.map((track) => track.artist))];
  const sub = isAlbum
    ? artists.slice(0, 3).map(dispArtist).join(', ')
    : t('detail.albumsCount', { n: new Set(list.map((track) => track.album)).size });
  // Desde un álbum se puede saltar a su artista (si es uno solo)
  const artistBtn = isAlbum && artists.length === 1
    ? `<button class="btn-ghost" id="goto-artist">${ICON('mic')} ${esc(t('np.artist'))}</button>`
    : '';
  const title = isAlbum ? dispAlbum(state.detail.key) : dispArtist(state.detail.key);
  return `
    <div class="detail-header">
      <div class="detail-art ${isAlbum ? '' : 'round'}">
        ${withArt ? artHtml(withArt, isAlbum ? 'disc' : 'mic') : ''}
      </div>
      <div class="detail-info">
        <div class="detail-kind">${esc(isAlbum ? t('detail.album') : t('detail.artist'))}</div>
        <h1 class="detail-title">${esc(title)}</h1>
        <div class="detail-sub">${esc(sub)}</div>
        <div class="detail-actions">
          <button class="btn-primary" id="play-all">${ICON('play')} ${esc(t('list.playAll'))}</button>
          ${artistBtn}
        </div>
      </div>
    </div>`;
}

function renderPlaylistHeader(pl, list) {
  const withArt = list.find((track) => track.picture);
  const cover = withArt ? coverUrlOf(withArt) : null;
  return `
    <div class="detail-header">
      <div class="detail-art">${cover ? `<img src="${cover}" alt="">` : genArt(pl.name, 'queue')}</div>
      <div class="detail-info">
        <div class="detail-kind">${esc(t('detail.list'))}</div>
        <h1 class="detail-title">${esc(pl.name)}</h1>
        <div class="detail-sub">${t('list.count', { n: list.length })}</div>
        <div class="detail-actions">
          <button class="btn-primary" id="play-all">${ICON('play')} ${esc(t('list.playAll'))}</button>
          <button class="icon-btn" id="pl-rename" title="${esc(t('detail.rename'))}">${ICON('edit')}</button>
          <button class="icon-btn" id="pl-delete" title="${esc(t('detail.deleteList'))}">${ICON('trash')}</button>
        </div>
      </div>
    </div>`;
}

function trackRow(track, index) {
  const isFav = state.favs.has(track.path);
  const selected = state.selected.has(track.id);
  // Solo el contenido largo lleva barra de escuchado (capítulos, mezclas)
  const heard = positionOf(track);
  const progress = isLongTrack(track)
    ? `<span class="row-progress ${isFinished(track) ? 'done' : ''}"><i style="width:${Math.min(100, (heard / track.duration) * 100)}%"></i></span>`
    : '';
  const indexCell = state.selectMode
    ? `<span class="row-check ${selected ? 'on' : ''}">${ICON('check')}</span>`
    : `<span class="num">${index + 1}</span>
       <span class="row-play">${ICON('play')}</span>
       <span class="row-eq"><i></i><i></i><i></i></span>`;
  return `
    <div class="track-row ${selected ? 'selected' : ''}" role="listitem" data-id="${track.id}" tabindex="0">
      <div class="row-index">${indexCell}</div>
      <div class="row-art">${artHtml(track)}</div>
      <div class="row-main">
        <div class="row-title">${esc(track.title)}</div>
        <div class="row-artist">${esc(dispArtist(track.artist))}</div>
        ${progress}
      </div>
      <div class="row-album">${esc(dispAlbum(track.album))}</div>
      <button class="row-more" title="${esc(t('list.more'))}" aria-label="${esc(t('list.more'))}">${ICON('more')}</button>
      <button class="fav-btn ${isFav ? 'is-fav' : ''}" title="${esc(t('player.fav'))}" aria-label="${esc(t('player.fav'))}">${ICON(isFav ? 'heart-fill' : 'heart')}</button>
      <div class="row-time">${fmtTime(track.duration)}</div>
    </div>`;
}

// La barra del capítulo en curso se mueve sola, sin repintar toda la lista
// (repintarla en cada segundo daría saltos con miles de canciones).
function updateCurrentRowProgress() {
  if (state.currentId == null || !audio.duration) return;
  const bar = $(`.track-row[data-id="${state.currentId}"] .row-progress i`);
  if (bar) bar.style.width = `${Math.min(100, (audio.currentTime / audio.duration) * 100)}%`;
}

// El botón "Continuar en…" del libro abierto, al día mientras suena
function updateBookButton() {
  const btn = $('#play-book');
  if (!btn || state.detail?.type !== 'book' || state.currentId == null) return;
  const track = trackById(state.currentId);
  if (!track || dirOf(track.path) !== state.detail.dir) return;
  btn.innerHTML = `${ICON('play')} ${esc(t('books.continueAt', { time: fmtTime(audio.currentTime) }))}`;
}

function markRowFinished(id) {
  const row = $(`.track-row[data-id="${id}"] .row-progress`);
  if (!row) return;
  row.classList.add('done');
  row.querySelector('i').style.width = '100%';
}

function highlightPlaying() {
  $$('.track-row').forEach((row) => {
    const active = Number(row.dataset.id) === state.currentId;
    row.classList.toggle('playing', active);
    row.classList.toggle('paused', active && audio.paused);
  });
}

function renderPlayerBar() {
  const track = state.currentId != null ? trackById(state.currentId) : null;
  $('#player').classList.toggle('inactive', !track);
  document.body.classList.toggle('has-track', !!track);
  // Los saltos de 15/30 s solo tienen sentido en pistas largas
  document.body.classList.toggle('long-track', isLongTrack(track));
  renderExtras();

  if (track) {
    $('#p-art').innerHTML = `
      ${artHtml(track)}
      <span class="art-eq"><i></i><i></i><i></i></span>
      <span class="art-expand" id="art-expand"></span>`;
    $('#p-title').textContent = track.title;
    $('#p-artist').textContent = dispArtist(track.artist);
    const isFav = state.favs.has(track.path);
    $('#p-fav').innerHTML = ICON(isFav ? 'heart-fill' : 'heart');
    $('#p-fav').classList.toggle('is-fav', isFav);
    document.body.classList.toggle('fav-playing', isFav);
    const cover = coverUrlOf(track);
    $('#player').style.setProperty('--cover-bg', cover ? `url("${cover}")` : 'none');
  } else {
    $('#p-art').innerHTML = `<div class="gen-art idle">${ICON('note', 'gen-ph')}</div>`;
    $('#p-title').textContent = t('player.nothing');
    $('#p-artist').textContent = '';
    $('#p-fav').innerHTML = ICON('heart');
    $('#p-fav').classList.remove('is-fav');
    document.body.classList.remove('fav-playing');
    $('#player').style.setProperty('--cover-bg', 'none');
  }

  $('#btn-play').innerHTML = ICON(audio.paused ? 'play' : 'pause');
  $('#btn-shuffle').classList.toggle('on', state.shuffle);
  $('#btn-repeat').classList.toggle('on', state.repeat !== 'off');
  $('#btn-repeat').innerHTML = ICON(state.repeat === 'one' ? 'repeat-one' : 'repeat');
  const vol = audio.muted ? 0 : audio.volume;
  $('#btn-vol').innerHTML = ICON(vol === 0 ? 'vol-mute' : 'vol');
  $('#vol-range').value = vol * 100;
  setFill($('#vol-range'), vol * 100);
  $('#vol-value').textContent = Math.round(vol * 100);
  syncExpandUi();
  renderNowPlaying();
}

// ---------- Vista grande "Reproduciendo ahora" ----------

function isNowPlayingOpen() {
  return $('#np').classList.contains('open');
}

function toggleNowPlaying() {
  if (isNowPlayingOpen()) closeNowPlaying();
  else openNowPlaying();
}

function openNowPlaying() {
  if (state.currentId == null) return;
  $('#np').classList.add('open');
  syncExpandUi();
  renderNowPlaying();
  syncHash(); // el "atrás" del navegador la cierra
}

function closeNowPlaying() {
  const wasOpen = isNowPlayingOpen();
  $('#np').classList.remove('open');
  syncExpandUi();
  // Al volver a la lista, dejar a la vista la canción que suena
  if (wasOpen) {
    scrollCurrentIntoView(false);
    syncHash();
  }
}

// Las dos flechas (la del reproductor y la de la carátula) apuntan hacia
// arriba para abrir y hacia abajo para cerrar.
function syncExpandUi() {
  const open = isNowPlayingOpen();
  const label = open ? t('player.collapse') : t('player.expand');
  const icon = ICON(open ? 'chev-down' : 'expand');

  const btn = $('#btn-expand-np');
  btn.innerHTML = icon;
  btn.title = label;
  btn.setAttribute('aria-label', label);

  const overlay = $('#art-expand');
  if (overlay) overlay.innerHTML = icon;
  $('#p-art').title = label;
  document.body.classList.toggle('np-open', open);
}

function renderNowPlaying() {
  if (!isNowPlayingOpen()) return;
  const track = state.currentId != null ? trackById(state.currentId) : null;
  if (!track) {
    closeNowPlaying();
    return;
  }
  const url = coverUrlOf(track);
  $('#np-bg').innerHTML = url
    ? `<img src="${url}" alt="">`
    : genArt(`${track.artist}·${track.album}·${track.title}`);
  $('#np-art').innerHTML = artHtml(track);
  $('#np-title').textContent = track.title;
  $('#np-artist').textContent = dispArtist(track.artist);
  $('#np-album').textContent = dispAlbum(track.album);
}

// ---------- Editor de etiquetas ----------

function canWriteTrack(track) {
  return !!track.handle && typeof track.handle.createWritable === 'function' && extOf(track.file.name) === 'mp3';
}

function canDeleteTrack(track) {
  return !!track.handle && !!state.dirHandle;
}

function openEditor(id) {
  const track = trackById(id);
  state.editingId = id;
  state.editPicture = track.picture;
  $('#edit-title').value = track.title;
  $('#edit-artist').value = track.artist === UNKNOWN_ARTIST ? '' : track.artist;
  $('#edit-album').value = track.album === UNKNOWN_ALBUM ? '' : track.album;
  $('#edit-artist').placeholder = t('unknown.artist');
  $('#edit-album').placeholder = t('unknown.album');
  $('#edit-genre').value = track.genre || '';
  $('#edit-track').value = track.track ?? '';
  $('#edit-file').textContent = track.path;
  fillGenreList();
  updateCleanButton();
  renderEditCover();

  const warn = $('#edit-warn');
  const save = $('#edit-save');
  let blocked = true;
  if (!track.handle) {
    $('#edit-warn-text').textContent = t('editor.warnNoHandle');
  } else if (extOf(track.file.name) !== 'mp3') {
    $('#edit-warn-text').textContent = t('editor.warnNotMp3');
  } else {
    $('#edit-warn-text').textContent = t('editor.warnOk');
    blocked = false;
  }
  warn.classList.toggle('blocked', blocked);
  save.disabled = blocked;
  $('#edit-pick-img').disabled = blocked;
  $('#edit-modal').hidden = false;
}

const EDIT_TEXT_FIELDS = ['#edit-title', '#edit-artist', '#edit-album', '#edit-genre'];

// Sugerencias del campo Género: los que ya existen en la biblioteca
function fillGenreList() {
  const genres = [...new Set(state.tracks.map((track) => track.genre).filter(Boolean))].sort();
  $('#genre-list').innerHTML = genres.map((genre) => `<option value="${esc(genre)}">`).join('');
}

// El botón de limpiar solo se activa si hay algo codificado que limpiar
function updateCleanButton() {
  const dirty = EDIT_TEXT_FIELDS.some((sel) => cleanName($(sel).value) !== $(sel).value.trim());
  $('#edit-clean').disabled = !dirty;
}

let editCoverUrl = null;

function closeEditor() {
  $('#edit-modal').hidden = true;
  if (editCoverUrl) {
    URL.revokeObjectURL(editCoverUrl);
    editCoverUrl = null;
  }
  state.editingId = null;
  state.editPicture = null;
}

function renderEditCover() {
  const track = trackById(state.editingId);
  const cover = $('#edit-cover');
  if (editCoverUrl) {
    URL.revokeObjectURL(editCoverUrl);
    editCoverUrl = null;
  }
  if (state.editPicture) {
    editCoverUrl = URL.createObjectURL(state.editPicture);
    cover.innerHTML = `<img src="${editCoverUrl}" alt="">`;
  } else {
    cover.innerHTML = genArt(`${track.artist}·${track.album}·${track.title}`);
  }
  $('#edit-remove-img').disabled = !state.editPicture;
}

async function saveEdit() {
  const track = trackById(state.editingId);
  if (!track || !canWriteTrack(track)) return;

  const title = $('#edit-title').value.trim() || track.title;
  const artist = $('#edit-artist').value.trim();
  const album = $('#edit-album').value.trim();
  const genre = $('#edit-genre').value.trim();
  const trackNum = parseInt($('#edit-track').value, 10) || null;

  if (!(await ensureWritePermission(track, t('perm.whatSave')))) return;

  $('#edit-save').disabled = true;
  showToast(t('editor.saving'), 0);

  const wasCurrent = state.currentId === track.id;
  // Si la pista está sonando, Windows bloquea el reemplazo del archivo:
  // se suelta el audio, se guarda, y se reanuda donde iba.
  const playback = wasCurrent ? releaseCurrentFile() : null;

  try {
    const picture = state.editPicture;
    await writeId3(track.file, track.handle, { title, artist, album, genre, track: trackNum, picture });
    const newFile = await track.handle.getFile();

    if (track.coverUrl) {
      URL.revokeObjectURL(track.coverUrl);
      track.coverUrl = null;
    }
    Object.assign(track, {
      file: newFile,
      mtime: newFile.lastModified,
      title,
      artist: artist || UNKNOWN_ARTIST,
      album: album || UNKNOWN_ALBUM,
      genre,
      track: trackNum,
      picture,
      artFromFolder: false, // al guardar, la portada queda dentro del archivo
      coverKey: null,
    });

    if (wasCurrent) {
      restoreCurrentFile(newFile, playback);
      updateMediaSession(track);
      applyAccentFor(track);
      document.title = `${track.title} · ${dispArtist(track.artist)} — ${APP_NAME}`;
    }

    closeEditor();
    render();
    scheduleSaveLibrary();
    showToast(t('editor.saved'), 3000);
  } catch (e) {
    console.error(e);
    if (wasCurrent) restoreCurrentFile(track.file, playback); // reanudar aunque fallara
    showToast(t('editor.error', { msg: e.message }), 5000);
    $('#edit-save').disabled = false;
  }
}

// ---------- Eliminar del disco ----------

// La carpeta padre del archivo, recorriendo su ruta relativa desde la raíz.
async function parentDirOf(track) {
  if (!state.dirHandle) return null;
  const parts = track.path.split('/');
  parts.pop();
  let dir = state.dirHandle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  return dir;
}

async function deleteTrack(id) {
  const track = trackById(id);
  if (!track) return;
  if (!canDeleteTrack(track)) {
    showToast(t('del.noHandle'), 4500);
    return;
  }

  const ok = await openDialog({
    icon: 'trash',
    danger: true,
    title: t('del.title'),
    bodyHtml: `
      <p><strong>${esc(track.title)}</strong><br><span class="dlg-note">${esc(dispArtist(track.artist))}</span></p>
      <p>${t('del.body', { path: esc(track.path) })}</p>
      <p class="dlg-note">${esc(t('del.warn'))}</p>`,
    confirmText: t('del.confirm'),
    cancelText: t('dialog.cancel'),
  });
  if (!ok) return;

  if (!(await ensureWritePermission(track, t('perm.whatDelete')))) return;

  const wasCurrent = state.currentId === id;
  const playback = wasCurrent ? releaseCurrentFile() : null;

  try {
    const dir = await parentDirOf(track);
    if (!dir) throw new Error('no dir');
    await dir.removeEntry(track.path.split('/').pop());
  } catch (e) {
    console.error(e);
    if (wasCurrent) restoreCurrentFile(track.file, playback);
    showToast(t('del.error', { msg: e.message }), 5000);
    return;
  }

  // El editor guarda un índice: tras reindexar apuntaría a otra canción.
  if (state.editingId != null) closeEditor();
  forgetTrack(track);

  if (wasCurrent) {
    if (state.qPos >= 0 && state.qPos < state.queue.length) playCurrent();
    else stopPlayback();
  }
  render();
  scheduleSaveLibrary();
  showToast(t('del.done'), 3000);
}

// Quita la pista del estado. Los ids son índices en state.tracks, así que hay
// que reindexar y remapear cola, pista actual, favoritos y listas.
function forgetTrack(removed) {
  const oldQueue = state.queue.map((i) => state.tracks[i]);
  const oldBase = state.baseQueue.map((i) => state.tracks[i]);
  const currentTrack = state.currentId != null ? state.tracks[state.currentId] : null;
  const removedQPos = oldQueue.indexOf(removed);

  state.tracks = state.tracks.filter((track) => track !== removed);
  state.tracks.forEach((track, i) => { track.id = i; });
  state.queue = oldQueue.filter((track) => track !== removed).map((track) => track.id);
  state.baseQueue = oldBase.filter((track) => track !== removed).map((track) => track.id);

  if (currentTrack === removed) {
    // Su hueco en la cola lo ocupa la siguiente canción.
    state.currentId = null;
    state.qPos = removedQPos >= 0 ? Math.min(removedQPos, state.queue.length - 1) : -1;
  } else if (currentTrack) {
    state.currentId = currentTrack.id;
    state.qPos = state.queue.indexOf(state.currentId);
  }

  if (removed.coverUrl) URL.revokeObjectURL(removed.coverUrl);
  if (state.favs.delete(removed.path)) setJson('favs', [...state.favs]);
  removePathFromAll(removed.path);
}

function renderQueue() {
  const panel = $('#queue-list');
  if (!state.queue.length) {
    panel.innerHTML = `<div class="empty">${esc(t('queue.empty'))}</div>`;
    return;
  }
  const upcoming = state.queue.slice(state.qPos).slice(0, 100);
  panel.innerHTML = upcoming.map((id, i) => {
    const track = trackById(id);
    // La que suena (i === 0) no se arrastra: es el punto fijo de la cola.
    return `
      <div class="queue-row ${i === 0 ? 'current' : ''}" data-qoffset="${i}" ${i > 0 ? 'draggable="true"' : ''}>
        ${i > 0 ? `<span class="q-grip" title="${esc(t('queue.reorder'))}">${ICON('grip')}</span>` : '<span class="q-grip"></span>'}
        <div class="row-art">${artHtml(track)}</div>
        <div class="row-main">
          <div class="row-title">${esc(track.title)}</div>
          <div class="row-artist">${esc(dispArtist(track.artist))}</div>
        </div>
        <div class="row-time">${fmtTime(track.duration)}</div>
        ${i > 0 ? `<button class="q-remove" title="${esc(t('queue.remove'))}" aria-label="${esc(t('queue.remove'))}">${ICON('x')}</button>` : ''}
      </div>`;
  }).join('');
  panel.querySelectorAll('.queue-row').forEach((row) => {
    const offset = Number(row.dataset.qoffset);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.q-remove') || e.target.closest('.q-grip')) return;
      state.qPos += offset;
      playCurrent();
    });
    row.querySelector('.q-remove')?.addEventListener('click', () => removeFromQueue(offset));
    if (offset > 0) bindQueueDrag(row, offset);
  });
}

// Arrastrar y soltar nativo: en escritorio es lo que la gente espera y no pide
// librerías. En táctil no funciona el DnD nativo, pero ahí el botón de quitar
// sigue estando y el orden es menos crítico.
let dragOffset = null;
let dropAt = null; // posición visible ANTES de la cual cae lo arrastrado

function clearDropMarks(panel) {
  panel.querySelectorAll('.drop-before, .drop-after').forEach((r) =>
    r.classList.remove('drop-before', 'drop-after'));
}

function bindQueueDrag(row, offset) {
  row.addEventListener('dragstart', (e) => {
    dragOffset = offset;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(offset)); // Firefox exige datos
  });
  row.addEventListener('dragend', () => {
    dragOffset = null;
    dropAt = null;
    row.classList.remove('dragging');
    clearDropMarks(row.parentElement);
  });
  row.addEventListener('dragover', (e) => {
    if (dragOffset == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Mitad de abajo = soltar después; así se puede llegar al último puesto,
    // imposible si solo se pudiera soltar "antes de" una fila.
    const rect = row.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    clearDropMarks(row.parentElement);
    row.classList.add(after ? 'drop-after' : 'drop-before');
    dropAt = after ? offset + 1 : offset;
  });
  row.addEventListener('drop', (e) => {
    if (dragOffset == null || dropAt == null) return;
    e.preventDefault();
    moveInQueue(dragOffset, dropAt);
  });
}

// ---------- Eventos ----------

function bindEvents() {
  bindDialog();

  $$('.nav-btn, .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToView(btn.dataset.view));
  });

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderMain();
  });

  $('#pick-folder').addEventListener('click', pickFolder);
  $('#change-folder').addEventListener('click', pickFolder);
  $('#remove-folder').addEventListener('click', removeFolder);
  $('#reopen-folder').addEventListener('click', reopenSaved);
  $('#folder-input').addEventListener('change', (e) => loadFromFileList(e.target.files));
  $('#privacy-info').addEventListener('click', showPrivacyInfo);
  // Los botones que abren menú también lo cierran al volver a pulsarlos
  $('#head-more').addEventListener('click', (e) => {
    if (menuIsOpen()) hideMenu();
    else openHeadMenu(e);
  });
  $('#settings-open').addEventListener('click', () => goToView('settings'));
  $('#welcome-lang').addEventListener('click', (e) => toggleMenuAt(e.currentTarget, langItems(), { above: false }));
  $('#goto-fab').addEventListener('click', () => scrollCurrentIntoView(true));

  $('#pl-new').addEventListener('click', () => {
    promptName(t('name.new'), '', (name) => {
      createPlaylist(name);
      render();
    });
  });

  const drop = $('#welcome');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    loadFromDrop(e.dataTransfer);
  });

  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-next').addEventListener('click', () => next(false));
  $('#btn-prev').addEventListener('click', prev);
  $('#btn-shuffle').addEventListener('click', toggleShuffle);
  $('#btn-repeat').addEventListener('click', cycleRepeat);
  $('#btn-back15').addEventListener('click', () => skip(-Number(getPref('skipBack', '15'))));
  $('#btn-fwd30').addEventListener('click', () => skip(Number(getPref('skipFwd', '30'))));
  $('#btn-extras').addEventListener('click', (e) => {
    if (menuIsOpen()) hideMenu();
    else openExtrasMenu(e.currentTarget);
  });
  $('#p-fav').addEventListener('click', () => {
    if (state.currentId != null) toggleFav(state.currentId);
  });
  $('#p-art').addEventListener('click', toggleNowPlaying);
  $('#p-meta').addEventListener('click', toggleNowPlaying);
  $('#btn-expand-np').addEventListener('click', toggleNowPlaying);
  $('#np-close').addEventListener('click', closeNowPlaying);
  $('#np-edit').addEventListener('click', () => {
    if (state.currentId != null) openEditor(state.currentId);
  });
  $('#np-album-btn').addEventListener('click', () => {
    if (state.currentId != null) goToAlbum(trackById(state.currentId).album);
  });
  $('#np-artist-btn').addEventListener('click', () => {
    if (state.currentId != null) goToArtist(trackById(state.currentId).artist);
  });

  $('#btn-queue').addEventListener('click', () => {
    $('#queue-panel').classList.toggle('open');
  });
  $('#queue-close').addEventListener('click', () => {
    $('#queue-panel').classList.remove('open');
  });
  // Al pasar a móvil, la cola pasa a ocupar la pantalla entera: si venía
  // abierta del escritorio, taparía la biblioteca sin que se haya pedido.
  matchMedia('(max-width: 880px)').addEventListener('change', () => {
    $('#queue-panel').classList.remove('open');
  });

  // Atrás/adelante del navegador: cierra la vista grande o vuelve a la lista
  window.addEventListener('popstate', applyHash);

  // Selección múltiple
  $('#sel-close').addEventListener('click', () => {
    exitSelectMode();
    render();
  });
  $('#sel-all').addEventListener('click', toggleSelectAll);
  $('#sel-edit').addEventListener('click', openBatchEditor);
  $('#sel-queue').addEventListener('click', queueSelected);
  $('#sel-playlist').addEventListener('click', (e) => playlistMenuForSelection(e.currentTarget));
  $('#sel-book').addEventListener('click', markSelectionAsBooks);
  $('#sel-delete').addEventListener('click', deleteSelected);

  // Edición por lotes
  $('#batch-close').addEventListener('click', closeBatchEditor);
  $('#batch-cancel').addEventListener('click', closeBatchEditor);
  $('#batch-save').addEventListener('click', saveBatch);
  $('#batch-modal').addEventListener('click', (e) => {
    if (e.target === $('#batch-modal')) closeBatchEditor();
  });

  // Editor
  $('#edit-close').addEventListener('click', closeEditor);
  $('#edit-cancel').addEventListener('click', closeEditor);
  $('#edit-clean').addEventListener('click', () => {
    for (const sel of EDIT_TEXT_FIELDS) $(sel).value = cleanName($(sel).value);
    updateCleanButton();
  });
  for (const sel of EDIT_TEXT_FIELDS) {
    $(sel).addEventListener('input', updateCleanButton);
  }
  $('#edit-modal').addEventListener('click', (e) => {
    if (e.target === $('#edit-modal')) closeEditor();
  });
  $('#edit-save').addEventListener('click', saveEdit);
  $('#edit-pick-img').addEventListener('click', () => $('#edit-img-input').click());
  $('#edit-remove-img').addEventListener('click', () => {
    state.editPicture = null;
    renderEditCover();
  });
  $('#edit-img-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.editPicture = await processCoverImage(file);
      renderEditCover();
    } catch {
      showToast(t('editor.imageError'), 3000);
    }
  });

  // Modal de nombre
  $('#name-close').addEventListener('click', closeName);
  $('#name-modal').addEventListener('click', (e) => {
    if (e.target === $('#name-modal')) closeName();
  });
  $('#name-save').addEventListener('click', submitName);
  $('#name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitName();
  });

  // Menú contextual: cerrar al hacer clic fuera o al hacer scroll
  document.addEventListener('click', (e) => {
    if (!menuIsOpen()) return;
    if (menuOwnsEvent(e.target)) return; // el menú o el botón que lo abrió
    hideMenu();
  });
  $('#main-scroll').addEventListener('scroll', hideMenu);

  const seek = $('#seek-range');
  seek.addEventListener('input', () => {
    seeking = true;
    setFill(seek, seek.value / 10);
    $('#time-cur').textContent = fmtTime((seek.value / 1000) * (audio.duration || 0));
  });
  seek.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
    seeking = false;
  });

  $('#vol-range').addEventListener('input', (e) => {
    audio.volume = e.target.value / 100;
    audio.muted = false;
    setPref('volume', audio.volume);
    renderPlayerBar();
  });
  $('#btn-vol').addEventListener('click', () => {
    audio.muted = !audio.muted;
    renderPlayerBar();
  });

  audio.addEventListener('play', () => {
    document.body.classList.add('playing');
    document.title = state.currentId != null
      ? `▶ ${trackById(state.currentId).title} — ${APP_NAME}`
      : APP_NAME;
    startViz(audio, $('#p-viz'));
    renderPlayerBar();
    highlightPlaying();
  });
  audio.addEventListener('pause', () => {
    document.body.classList.remove('playing');
    savePlaybackPosition();
    stopViz();
    renderPlayerBar();
    highlightPlaying();
  });
  audio.addEventListener('ended', () => {
    if (state.currentId != null) {
      markFinished(trackById(state.currentId));
      markRowFinished(state.currentId);
    }
    if (sleepAtTrackEnd) {
      cancelSleep();
      showToast(t('player.sleepDone'), 5000);
      return; // el temporizador manda: no encadena la siguiente
    }
    next(true);
  });
  audio.addEventListener('error', () => {
    if (state.currentId != null && state.queue.length > 1) next(true);
  });
  audio.addEventListener('timeupdate', () => {
    if (seeking || !audio.duration) return;
    if (!countedCurrentPlay && audio.currentTime > 20) {
      countedCurrentPlay = true;
      countPlay(state.currentId != null ? trackById(state.currentId) : null);
    }
    if (Math.abs(audio.currentTime - lastResumeSave) > 5) {
      savePlaybackPosition();
      updateBookButton();
    }
    updateCurrentRowProgress();
    const pct = (audio.currentTime / audio.duration) * 100;
    $('#seek-range').value = pct * 10;
    setFill($('#seek-range'), pct);
    $('#time-cur').textContent = fmtTime(audio.currentTime);
    $('#time-total').textContent = fmtTime(audio.duration);
  });
  audio.addEventListener('loadedmetadata', () => {
    const track = state.currentId != null ? trackById(state.currentId) : null;
    if (track && isFinite(audio.duration)) track.duration = audio.duration;
    $('#time-total').textContent = fmtTime(audio.duration);
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (isDialogOpen()) {
        closeDialog(false);
        return;
      }
      hideMenu();
      $('#queue-panel').classList.remove('open');
      closeNowPlaying();
      if (!$('#edit-modal').hidden) closeEditor();
      if (!$('#batch-modal').hidden) closeBatchEditor();
      if (!$('#name-modal').hidden) closeName();
      if (state.selectMode) {
        exitSelectMode();
        render();
      }
      return;
    }
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight' && audio.src) {
      audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || 0);
    } else if (e.code === 'ArrowLeft' && audio.src) {
      audio.currentTime = Math.max(audio.currentTime - 5, 0);
    }
  });
}

// ---------- Inicio ----------

// Lo que los ajustes necesitan de la app (settings.js no importa app.js)
function settingsContext() {
  return {
    changeLang,
    hasBooks,
    action: (key) => {
      if (key === 'resetStats') resetStats();
    },
    onChange: (key, value) => {
      if (key === 'viz') {
        stopViz();
        if (value !== 'off' && !audio.paused) startViz(audio, $('#p-viz'));
      } else if (key === 'accent') {
        if (value === '1') refreshAccent();
        else resetAccent();
      } else if (key === 'folderArt') {
        showToast(t('settings.reloadNeeded'), 4000);
      }
    },
  };
}

function refreshAccent() {
  const track = state.currentId != null ? trackById(state.currentId) : null;
  if (track) applyAccentFor(track);
}

function resetStats() {
  stats = {};
  setJson('stats', stats);
  for (const track of state.tracks) {
    track.plays = 0;
    track.lastPlayed = 0;
  }
  render();
  showToast(t('settings.statsCleared'), 2500);
}

async function init() {
  applyStatic();
  initSettings(settingsContext());
  setLangLabels(getLang());
  bindEvents();
  applySpeed();
  renderNav();
  renderPlayerBar();
  setFill($('#seek-range'), 0);
  setFill($('#vol-range'), audio.volume * 100);

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (!window.showDirectoryPicker) {
    $('#pick-folder .pick-hint').textContent = t('welcome.pickFallback');
  }

  try {
    const saved = await kvGet('dirHandle');
    if (saved && window.showDirectoryPicker) {
      let count = 0;
      try {
        const lib = await kvGet('library');
        count = lib?.tracks?.length || 0;
      } catch { /* sin caché */ }
      savedFolder = { name: getPref('folderName') || saved.name, count };
      $('#reopen-folder').hidden = false;
      refreshReopenLabel();
    }
  } catch { /* IndexedDB no disponible */ }
}

init();
