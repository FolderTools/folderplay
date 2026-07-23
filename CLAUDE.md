# FolderPlay

Reproductor de música local que corre 100% en el navegador. El usuario elige una
carpeta de su equipo (su "base de datos" es esa carpeta) y la app reproduce los
archivos sin subir nada a ningún servidor. Sitio estático de Astro desplegado en
Cloudflare Pages, en **folderplay.com**.

> Se llamaba *Miusic*. El nombre solo sobrevive en el proyecto de Cloudflare
> (`miusic`), porque renombrarlo obligaría a recrearlo y reconectar el dominio.
> En el código y la interfaz todo es FolderPlay.

## Comandos

```bash
npm run dev       # servidor de desarrollo (localhost:4321)
npm run build     # build estático a dist/
npm run check     # análisis estático (lo que el build no detecta)
npm run smoke     # evalúa el bundle de dist/ sobre un DOM falso (pide build antes)
npm run deploy    # check + build + smoke + wrangler pages deploy (proyecto: miusic)
```

**La red de seguridad.** No hay tipos ni tests, así que estas dos herramientas
son lo único que separa un error de un despliegue roto. Las dos se ejecutan en
`npm run deploy`.

`npm run check` (`scripts/check.mjs`) comprueba seis cosas:

1. Todo `$('#id')` existe en el marcado. Si el elemento se crea con innerHTML,
   añadirlo a `DYNAMIC_IDS`.
2. Toda clave de i18n usada existe en español.
3. Todo lo que hay en español está también en los demás idiomas.
4. Ningún archivo lleva bytes nulos.
5. **Ningún identificador se usa sin declarar ni importar** (`scripts/undeclared.mjs`,
   con acorn), y ningún import sobra. Esto es lo que hace seguro mover código
   de un archivo a otro: al repartir app.js, lo que se rompe es una variable
   que se quedó en el origen, y ni el build ni el navegador avisan hasta que la
   app aparece en blanco. El análisis da por buenas todas las declaraciones del
   archivo sin mirar ámbitos: prefiere escapársele un caso de sombreado a
   acusar a un nombre que sí existe.
6. Ningún módulo importa de app.js y no hay ciclos de importación.

`npm run smoke` (`scripts/smoke.mjs`) evalúa el bundle ya compilado —el mismo
que sirve Cloudflare— sobre un DOM de mentira hecho con un `Proxy` que responde
a cualquier cosa. No prueba la interfaz (eso pide navegador), pero sí que todos
los módulos cargan, que no hay ciclos que dejen valores a medias y que `init()`
llega al final sin lanzar.

## Arquitectura

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
- **Regla de dependencias** (la vigila `npm run check`): las dependencias van
  siempre hacia abajo y **ningún módulo importa de `app.js`**.
  1. Hojas, no importan nada: `utils`, `prefs`.
  2. Sobre ellas: `i18n`, `dialog`, `accent`, `playlists`, `db`, `metadata`,
     `id3-writer`, `ui`.
  3. `state` (importa `prefs` e `i18n`) y, sobre él, `settings`, `positions`,
     `books`, `library`, `permissions`, `viz`.
  4. `app.js`, que importa de todos y no exporta nada.

  Si un módulo necesita algo de la app (repintar, cambiar de idioma…), **no se
  importa: llega por el contexto de su `init`**, como hace `initSettings`. Eso
  es lo que evita los ciclos.

## Trampas conocidas (no repetir)

- **Las claves de prefs son un espacio de nombres compartido.** Un ajuste del
  registro (`resume`, valor '1'/'0') y un dato de la app no pueden llamarse
  igual: al guardar el dato se pisaba el ajuste, que pasaba a leerse como
  apagado y desactivaba media función sin error visible. De ahí `lastSession`
  y `bookSpeedByDir`. `getSetting()` además valida el valor contra el tipo y
  cae al de por defecto si no encaja.
- **Los clics dentro del menú contextual llevan `stopPropagation()`.** Si no,
  el clic burbujea hasta `document`, que cierra el menú; y como el contenido se
  reemplaza al abrir un submenú, el elemento pulsado ya no está dentro y no hay
  forma de distinguirlo. Igual con el botón que abre el menú: se guarda en
  `menuAnchor` en vez de mantener una lista de selectores (cada botón nuevo
  llegaba roto).

- **Flexbox en columna**: `.content` necesita `min-height: 0`. En móvil `.layout`
  es columna y, sin eso, la lista no hace scroll y se mete bajo el reproductor.
  Cualquier contenedor flex con un hijo scrollable tiene el mismo riesgo.
- **`zoom` y coordenadas**: con `zoom` en `:root`, `clientX`/`getBoundingClientRect`
  vienen en píxeles de pantalla pero lo que se escribe en `left`/`top` se
  multiplica por el zoom. Hay que dividir (`zoomFactor()` en app.js) o el menú
  se sale de la pantalla. Igual con `height: 100dvh` (se compensa dividiendo).
- **Repintado de máscaras**: un `-webkit-mask` sobre un elemento que se repinta
  seguido (el thumb de la barra de progreso) parpadea; mejor una imagen opaca.

- El permiso readwrite se pide sobre `state.dirHandle` (la carpeta), nunca
  primero sobre un archivo hijo: Chrome lo deniega sin diálogo y consume la
  activación del usuario.
- Los diálogos propios resuelven su promesa **dentro** del clic del botón: por
  eso se puede llamar a `showDirectoryPicker()` o `requestPermission()` justo
  después del `await` sin perder la activación del usuario.
- Antes de reescribir o borrar un MP3 en reproducción hay que soltar el audio
  (`releaseCurrentFile()`): Windows bloquea el archivo abierto. Después
  `restoreCurrentFile()` reanuda en la misma posición.
- `state.tracks` se indexa por posición y la cola guarda esos índices: al
  eliminar una canción hay que reindexar y remapear (`forgetTrack`), nunca
  hacer `splice` a secas.
- La vista grande (#np) usa visibility+transform; sin `visibility: hidden`
  cerrada tapa la barra del reproductor (translateY(100%) la deja encima).
- Las dos flechas de "ver en grande" (la de la barra y la de la carátula) se
  actualizan en `syncExpandUi()`; si se pinta el icono en otro sitio, se queda
  apuntando siempre hacia arriba.
- **Un `<canvas>` posicionado en absoluto necesita `height` explícito.** Es un
  elemento reemplazado: con `height: auto`, `top` y `bottom` a la vez quedan
  sobredefinidos, se ignora `bottom` y se queda en sus 150px intrínsecos.
- **Nada de bytes nulos literales en el código.** `libraryKey` usa `\0` como
  separador y durante un tiempo estuvo escrito como el carácter en crudo: los
  editores y `grep`/ripgrep pasaban a tratar `app.js` como binario y dejaban de
  buscar dentro. Escrito como escape el valor guardado es idéntico, así que
  las marcas de libros que ya tuviera el usuario siguen valiendo.
- Voltear un icono simétrico no comunica nada: `#i-sort` (flecha arriba y
  flecha abajo) con `scaleY(-1)` se veía idéntico y no se distinguía el orden
  ascendente del descendente. De ahí `#i-arrow-up` y la palabra al lado.
- **No quedarse en la vista Libros sin libros.** La pestaña Libros se oculta si
  `hasBooks()` es falso, así que estar en `state.view === 'books'` (o en un
  `#book/<dir>` que ya no existe) con cero libros deja una vista que la interfaz
  no ofrece y se ve **en blanco, sin error en consola**. Pasa al desmarcar el
  último libro estando dentro, y al reabrir con el hash `#books` (antes del
  escaneo las duraciones son `null`, así que los libros solo detectados aún no
  cuentan). `normalizeView()`, al principio de `render()`, cae a Canciones si el
  libro del detalle ya no existe o si la vista Libros se quedó sin libros.
- **Un fallo al reproducir no puede ser mudo ni entrar en bucle.** El handler de
  `audio.error` avisa (`toast.playFailed`) y salta a otra pista, pero **nunca por
  `next()`**: con `repeat 'one'` reintentaría la rota para siempre. Cuenta los
  fallos seguidos (`playFailStreak`); a los `MAX_PLAY_FAILS` sin que ninguno
  cargue no es un archivo suelto corrupto sino acceso perdido (carpeta movida o
  permiso cerrado), así que para y avisa (`toast.playStopped`) en vez de recorrer
  toda la biblioteca lanzando errores. Se repone en `loadedmetadata` (archivo
  legible). El guard `if (!audio.error …)` es clave: soltar el archivo para
  editar/borrar (`removeAttribute`+`load`) no deja `audio.error`, así que ese
  caso no dispara un salto de pista.
- **Un fallo leyendo la carpeta debe cerrar el velo de carga.** `scanDirectory`
  abre el loader; si `getFile()` peta a mitad (handle obsoleto: carpeta movida o
  borrada) el velo se queda colgado y la app parece congelada. `loadFromHandle`
  lo envuelve en try/catch (hideLoader + `toast.loadFailed`), y por eso cubre los
  tres caminos a la vez: elegir, reabrir y arrastrar.
- **Red de seguridad global.** `window` escucha `error` y `unhandledrejection`
  (en `bindEvents`) → aviso no-fatal `toast.oops` en vez de congelarse en
  silencio. Va throttled a 8 s para no saturar si algo falla en cada frame, y
  solo actúa ante fallos reales de JS (`e.error`): los de recursos (una carátula
  que no carga) no traen `error` y se ignoran a propósito.

## Decisiones clave

- **Sin backend ni dependencias de runtime**: todo es File System Access API +
  `<audio>` + object URLs. No añadir librerías para metadatos sin justificación.
- La carpeta elegida se persiste como `FileSystemDirectoryHandle` en IndexedDB
  (`folderplay > kv > dirHandle`); reabrirla requiere un gesto del usuario
  (`requestPermission`). Solo funciona en Chromium; Firefox/Safari usan el
  fallback `<input webkitdirectory>` o arrastrar la carpeta.
- Preferencias (favoritos, volumen, shuffle, repeat, orden, playlists) en
  `localStorage` vía `prefs.js`. Favoritos y playlists identifican canciones por
  ruta relativa del archivo, no por índice.
- **Caché de biblioteca**: IndexedDB v2 (`kv.library` + store `covers`). Los
  metadatos se cachean por (ruta, tamaño, mtime); al reabrir solo se re-analizan
  archivos nuevos/cambiados. Las carátulas se deduplican por hash de contenido
  (`coverKeyOf`) y se recolectan las huérfanas en `syncCovers`. La base antigua
  (`miusic`) se copia una sola vez al arrancar y se elimina.
- **Confianza antes que permisos**: cualquier aviso del navegador (elegir
  carpeta, permiso de edición) va precedido de un diálogo propio que explica qué
  va a pasar. El aviso de Chrome no se puede modificar, así que se anticipa.
- **Eliminar del disco**: `parentDirOf()` + `removeEntry()`. Se confirma con
  diálogo propio avisando de que no pasa por la papelera.
- **PWA**: `public/manifest.webmanifest` + `public/sw.js` (network-first para
  navegación, cache-first para assets con hash). El SW solo se registra en
  producción (`import.meta.env.PROD`). Al cambiar assets, subir la versión de
  `CACHE`.
- **Color adaptativo**: `updateAccent()` calcula el color dominante de la
  carátula (histograma de tonos en canvas 20×20) y reescribe las variables
  `--accent*` en `:root`; `resetAccent()` restaura el morado por defecto.
- CSS: existe una regla global `[hidden] { display:none !important }` porque
  las clases con `display:flex` (loader, modales) anulaban el atributo hidden.
- Los metadatos se leen en segundo plano (4 workers) tras el primer render; las
  duraciones que faltan (m4a/ogg) se obtienen después con elementos `<audio>`.
- **Nunca se copian archivos**: los `File` son referencias perezosas al disco;
  solo se leen los bytes de etiquetas/carátulas y lo que el `<audio>` streamea.
- Los "álbumes" salen de la etiqueta TALB/ALBUM de cada archivo, no de la
  estructura de carpetas (las subcarpetas solo se recorren para encontrar audio).
- Al volver de la vista grande o de un detalle, `scrollCurrentIntoView()` deja
  la canción en curso centrada y con un destello, para no buscarla a mano.
  Además `watchCurrentRow()` (IntersectionObserver) muestra el botón flotante
  cuando esa fila se sale de pantalla, con la flecha hacia donde quedó.
- **Móvil**: no se encoge el escritorio, se reorganiza. La navegación baja a
  `.tabbar`, la cabecera queda con marca + menú (`#head-more`) y el reproductor
  es una sola fila; con la vista grande abierta, la propia barra del reproductor
  se recoloca dentro (`body.np-open .player`) para no duplicar controles.
- **Escala**: en ventanas ≥1000px se aplica `zoom: 1.1` (el tamaño que el
  usuario prefería con el zoom del navegador). `zoom` no escala vh/vw y sí
  escala la altura, así que en ese bloque se compensan `height: calc(100dvh/1.1)`
  y los máximos en vh.
- Los textos "Artista/Álbum desconocido" que escribe metadata.js son valores de
  datos (van a la caché); solo se traducen al pintar, con `dispArtist/dispAlbum`.
- **Los nombres del archivo no se tocan solos**: si vienen codificados
  (`&quot;`, `+`, `%20`) se muestran tal cual para que el usuario vea que el
  archivo está mal, y se limpian con el botón del editor (`cleanName` en
  utils.js) o con la casilla de la edición por lotes. Fue decisión suya.
- **Portada suelta de la carpeta** (`cover.jpg`…): implementada pero apagada
  (`folderArt`, off). En carpetas con música mezclada asignaba la misma imagen a
  canciones de otros álbumes. Al reactivarla habría que exigir que las pistas de
  esa carpeta compartan álbum. Las portadas ya cacheadas con `artFromFolder` se
  ignoran mientras esté apagada.
- `PARSER_VERSION` invalida la caché de la biblioteca: subirlo obliga a releer
  las etiquetas de todos los archivos. Solo al cambiar cómo se interpretan.
- **Una página por intención de búsqueda**, no una que lo cubra todo (rankea
  peor para las dos). La portada de `/` sigue centrada en música; `/audiolibros/`
  (y `/en/audiobooks/`) reusa la misma app con su título, descripción y titular
  propios. Es la misma aplicación: solo cambia la puerta de entrada. AppShell
  recibe `variant` y elige las claves del titular de la bienvenida; el texto de
  reserva va en español, como en el resto, e i18n lo traduce en caliente.
- **Los cambios baratos no reconstruyen la lista.** Con 1600 pistas, rehacer
  todo el `innerHTML` en cada acción (marcar un favorito, seleccionar uno) daba
  tirones. `paintFav` y `syncSelectionUI` tocan las filas ya pintadas, como
  `highlightPlaying`/`updateCurrentRowProgress`. Quitar el favorito en la
  **vista de Favoritos** sí repinta (la fila desaparece).
- **`content-visibility: auto` en las filas se probó y se quitó.** Abarataba la
  primera pintura, pero como el canvas del reproductor dibuja por el hilo
  principal en cada frame, obligaba a re-evaluar la relevancia de las miles de
  filas contenidas en cada frame → el efecto caía a ~10 fps solo en Canciones.
- **El canvas del visualizador va en su propia capa** (`.p-viz` con
  `translateZ(0)` + `will-change`). Sin eso, su repintado por frame recomponía
  la capa del documento (con las miles de filas) y volvía a hundir los fps con
  bibliotecas grandes. En su capa, cada frame solo re-sube su textura. Además
  `viz.js` no lee prefs ni `matchMedia` por frame: fija el modo al arrancar
  (cambiarlo reinicia el viz).
- **Reordenar la cola**: arrastrar y soltar nativo (sin librerías), solo en las
  pistas que vienen (la que suena es el punto fijo). `moveInQueue(from, to)`
  usa offsets visibles; `to` es la posición ANTES de la cual cae, y la mitad
  inferior de una fila cuenta como "después" para poder llegar al último puesto.
  El nuevo orden se refleja en `baseQueue` por id, para que quitar el aleatorio
  lo respete. En táctil el DnD nativo no va, pero el botón de quitar sí.
- **Un libro es una carpeta**. `bookList()` la detecta sola (algún .m4b o el
  60% de sus pistas de más de 15 min) y el usuario puede marcarla o desmarcarla
  (`books` en prefs, con listas `yes`/`no`: lo marcado manda sobre lo
  detectado). La sección Libros y los ajustes de libros solo aparecen si hay
  alguno, así que quien solo tiene música no ve nada nuevo.
- Las marcas se guardan con `libraryKey(dir)` = carpeta abierta + ruta. Con la
  ruta sola, la raíz es `""` en todas las bibliotecas y una marca se aplicaba a
  la siguiente carpeta que abrieras.
- **No hay libros "sueltos" de pistas escogidas a mano**: marcar es siempre una
  acción de carpeta, también desde la selección múltiple (`markSelectionAsBooks`
  marca las carpetas de lo seleccionado, no las pistas). Un conjunto arbitrario
  de archivos ya tiene nombre en esta app y es *lista de reproducción*; lo que
  una lista no puede dar —capítulos ordenados, progreso del conjunto, velocidad
  propia— es justo lo que ata el libro a una carpeta. Si algún día hace falta
  cubrir un libro mezclado con música en la misma carpeta, el cambio es que
  `bookList()` acepte libros con lista explícita de rutas, no marcar por pista.
- **Los capítulos de un libro no aparecen en Canciones, Álbumes ni Artistas**
  (`musicTracks()`); sí en Favoritos y en listas, porque ahí están porque el
  usuario los puso. Marcar/desmarcar es una acción de carpeta: la etiqueta del
  menú lleva el nombre de la carpeta para que se vea que afecta al grupo.
- "Continuar" lleva al **último capítulo escuchado** de ese libro
  (`bookLastChapter`), no al primero sin terminar.
- Un capítulo terminado se guarda con su duración completa en `positions`: así
  cuenta para el progreso del libro y no se ofrece retomarlo. La velocidad se
  recuerda **por libro** (`bookSpeeds`), que es lo que cambia entre narradores.
- **Contenido largo, no "modo audiolibro"**: manda la duración de la pista, no
  un ajuste. A partir de `LONG_CONTENT` (15 min) aparecen los saltos de 15/30 s
  (`body.long-track`) y se guarda la posición **por archivo** (`positions` en
  prefs, podadas a 300), que es lo que permite tener varios libros a medias.
  Velocidad (`applySpeed`, hay que reponerla al cargar otro archivo porque el
  navegador la resetea) y temporizador viven en el menú de `#btn-extras`.
- **Estadísticas de escucha**: `stats` en prefs (`{ruta: [nº, última vez]}`), se
  cuenta a los 20 segundos de reproducción. Alimentan los órdenes "más
  reproducidas" y "escuchadas hace poco".
- La edición por lotes escribe archivo a archivo con progreso y sigue aunque
  alguno falle; al final informa de cuántos fueron y cuántos no.
- **Idioma de la interfaz**: gana la preferencia guardada; si no hay, el
  `<html lang>` de la página (para que /en/ y quien la rastree vean inglés); y
  si tampoco, el del navegador. Cambiar de idioma no navega: recargaría la app
  y el usuario perdería la carpeta abierta.
- **Las ondas ocupan solo la franja central** del reproductor, a la anchura de
  la barra de progreso (`min(38%, 560px)`, centrada). Cruzando la barra entera
  pasaban por detrás del título y del volumen, que es donde hay que leer. En
  móvil vuelven a ancho completo: allí la rejilla ya no es simétrica.
- **La dirección del orden se dice con palabras**, no solo con una flecha:
  "ascendente" no distingue la canción más corta de la más larga.
  `SORT_DIR_LABELS` nombra los dos extremos de cada criterio y los de texto
  comparten A-Z/Z-A. El criterio se elige con el menú propio, no con un
  `<select>` nativo (no se puede tematizar; mismo motivo que en idioma).
- **Pieles del reproductor**: variantes solo CSS sobre el mismo marcado
  (`body[data-skin]`), nunca ramas de JavaScript. El tamaño de interfaz es
  `html[data-scale]` con `zoom` (ver la trampa de coordenadas).
- Logo provisional: carpeta con un play recortado (`fill-rule="evenodd"` en el
  símbolo `#i-logo`, `public/favicon.svg` y los PNG del manifest).
- Textos de la interfaz en español. Escapar siempre strings de archivos del
  usuario con `esc()` antes de inyectar en innerHTML.

## Despliegue

Cloudflare Pages con wrangler. Es un proyecto de "Direct Upload" con dos
dominios: `folderplay.com` (el bueno, canónico) y `miusic.pages.dev`. Requiere
HTTPS porque la File System Access API solo funciona en contextos seguros.

- **Trampa de la rama.** En Cloudflare la **rama de producción es `main`**; el
  dominio sirve solo los despliegues de esa rama. En git, en cambio, las ramas
  son `prod` (por defecto/publicada) y `develop`. No coinciden a propósito: si
  `wrangler pages deploy` no lleva `--branch=main`, detecta la rama de git
  (`prod`) y sube a **Preview**, y el dominio no cambia. Por eso el script de
  `deploy` fija `--branch=main`. Comprobar con
  `wrangler pages deployment list --project-name=miusic` (columna Environment).
- El repositorio es `github.com/FolderTools/folderplay` (público). La rama por
  defecto del repo es `prod`. El README del perfil de la organización vive en
  otro repo, `FolderTools/.github`, en `profile/README.md`.
- Tras desplegar, la home puede tardar unos minutos en refrescarse por la caché
  del edge; las rutas nuevas salen al momento. El build local, la URL directa
  del despliegue (`<hash>.miusic.pages.dev`) y `dist/` son la fuente de verdad
  para verificar antes de que propague.
