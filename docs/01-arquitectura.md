# 01 — Arquitectura

Qué hace cada archivo. La **regla de dependencias** que gobierna todo esto está
en `AGENTS.md`, porque no se puede romper nunca; aquí están las capas que la
hacen cierta.

## Marcado y páginas

- `src/components/AppShell.astro` — **todo el marcado del cuerpo** (sprite de
  iconos, layout, reproductor, vistas, modales, diálogo, loader, toast, menú).
  Lo comparten las páginas de todos los idiomas: el marcado nunca se duplica.
- `src/components/HeadMeta.astro` — `<head>` por **página e idioma** (título,
  descripción, canonical, hreflang, Open Graph, JSON-LD). `PAGES[variant][lang]`:
  `home` (música) y `books` (audiolibros). Cada variante enlaza sus idiomas
  entre sí por hreflang. Añadir idioma = una entrada por variante; añadir
  variante = un bloque en `PAGES` + su cáscara en `src/pages/`.
- `src/pages/` — cáscaras de cuatro líneas (`<html lang>` + HeadMeta + AppShell):
  `index.astro` (es) y `en/index.astro` (música); `audiolibros/index.astro` y
  `en/audiobooks/index.astro` (audiolibros, `variant="books"`).
- `src/styles/global.css` — todo el diseño (tema oscuro, variables en `:root`).

## Módulos

- `src/scripts/app.js` — **orquestador**: reproducción/colas, vistas y render,
  navegación, selección múltiple, editor de etiquetas, borrado y eventos. Es
  quien conoce a todos los módulos; ninguno de ellos lo importa a él.
- `src/scripts/state.js` — el estado compartido (`state`), el elemento `audio`,
  `trackById`, `groupBy`, `dirOf` y las constantes que usan varios módulos
  (`Track` está documentado aquí con JSDoc). Es deliberadamente tonto: guarda
  datos y no toca la pantalla, y por eso todos pueden importarlo.
- `src/scripts/ui.js` — piezas que no saben nada de música: velo de carga,
  avisos efímeros y la mecánica del menú contextual (posición, `zoom`, cierre).
- `src/scripts/library.js` — leer el disco y recordar lo leído: recorrer
  carpetas (picker, `webkitdirectory` y arrastrar), reconocer audio, la caché de
  metadatos en IndexedDB y el sondeo de duraciones. Devuelve datos; no pinta.
- `src/scripts/positions.js` — por dónde vas en **cada archivo** (no solo en el
  último). Es lo que permite varios libros a medias a la vez.
- `src/scripts/books.js` — audiolibros: qué carpeta es un libro, orden de los
  capítulos, progreso, cuál toca y la velocidad por libro.
- `src/scripts/permissions.js` — confianza antes que permisos: los diálogos
  propios que anteceden a los del navegador y el permiso de escritura.
- `src/scripts/utils.js` — helpers puros ($, esc, ICON, fmtTime, genArt,
  cleanName, processCoverImage…).
- `src/scripts/prefs.js` — localStorage con prefijo `folderplay:` (migra solo
  las claves antiguas `miusic:`).
- `src/scripts/i18n.js` + `src/scripts/locales/*.js` — idiomas. Añadir uno =
  crear `locales/<código>.js` y registrarlo en `DICTS`; nada más cambia. El
  marcado estático se traduce con `data-i18n`, `data-i18n-html`,
  `data-i18n-placeholder`, `data-i18n-title` y `data-i18n-aria`.
- `src/scripts/dialog.js` — diálogo propio (confirmar / explicar permisos).
- `src/scripts/settings.js` — **registro declarativo de ajustes**. Añadir un
  ajuste = una entrada en `SETTINGS` (clave, sección, tipo, valor por defecto y
  `apply`) más sus textos `settings.<clave>` en locales. El panel se dibuja
  solo; `npm run check` falla si falta el texto. Tipos: `toggle`, `select`,
  `cards`, `action`. Lo que necesita de la app llega por el contexto de
  `initSettings` (no importa app.js).
- `src/scripts/viz.js` — ondas del audio en la barra (AnalyserNode + canvas).
- `src/scripts/db.js` — IndexedDB: handle de carpeta, caché de biblioteca,
  carátulas deduplicadas.
- `src/scripts/playlists.js` — CRUD de listas sobre localStorage.
- `src/scripts/accent.js` — color dominante de carátula → variables --accent*.
- `src/scripts/metadata.js` — parsers puros sin dependencias: ID3v2.2/2.3/2.4,
  ID3v1, FLAC (Vorbis comments + carátula), duración de mp3 (Xing/CBR).
- `src/scripts/id3-writer.js` — escribe etiquetas ID3v2.3 (título, artista,
  álbum, nº pista, portada APIC) en el MP3 real del usuario vía
  `createWritable()`; conserva los frames que no se editan. Solo MP3 y solo
  cuando hay `FileSystemFileHandle` (carpeta abierta con el picker en Chromium).

## Las capas

Las dependencias van siempre hacia abajo:

1. Hojas, no importan nada: `utils`, `prefs`.
2. Sobre ellas: `i18n`, `dialog`, `accent`, `playlists`, `db`, `metadata`,
   `id3-writer`, `ui`.
3. `state` (importa `prefs` e `i18n`) y, sobre él, `settings`, `positions`,
   `books`, `library`, `permissions`, `viz`.
4. `app.js`, que importa de todos y no exporta nada.

Si un módulo necesita algo de la app (repintar, cambiar de idioma…), **no se
importa: llega por el contexto de su `init`**, como hace `initSettings`. Eso es
lo que evita los ciclos.
