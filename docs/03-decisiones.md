# 03 — Decisiones clave

Por qué las cosas son como son. Lo que está aquí ya se discutió: si vas a
cambiarlo, hazlo con un motivo nuevo.

## Fundamentos

- **Sin backend ni dependencias de runtime**: todo es File System Access API +
  `<audio>` + object URLs. No añadir librerías para metadatos sin justificación.
- La carpeta elegida se persiste como `FileSystemDirectoryHandle` en IndexedDB
  (`folderplay > kv > dirHandle`); reabrirla requiere un gesto del usuario
  (`requestPermission`). Solo funciona en Chromium; Firefox/Safari usan el
  fallback `<input webkitdirectory>` o arrastrar la carpeta.
- **Nunca se copian archivos**: los `File` son referencias perezosas al disco;
  solo se leen los bytes de etiquetas/carátulas y lo que el `<audio>` streamea.
- **Confianza antes que permisos**: cualquier aviso del navegador (elegir
  carpeta, permiso de edición) va precedido de un diálogo propio que explica qué
  va a pasar. El aviso de Chrome no se puede modificar, así que se anticipa.
- **Eliminar del disco**: `parentDirOf()` + `removeEntry()`. Se confirma con
  diálogo propio avisando de que no pasa por la papelera.

## Datos y caché

- Preferencias (favoritos, volumen, shuffle, repeat, orden, playlists) en
  `localStorage` vía `prefs.js`. Favoritos y playlists identifican canciones por
  ruta relativa del archivo, no por índice.
- **Caché de biblioteca**: IndexedDB v2 (`kv.library` + store `covers`). Los
  metadatos se cachean por (ruta, tamaño, mtime); al reabrir solo se re-analizan
  archivos nuevos/cambiados. Las carátulas se deduplican por hash de contenido
  (`coverKeyOf`) y se recolectan las huérfanas en `syncCovers`. La base antigua
  (`miusic`) se copia una sola vez al arrancar y se elimina.
- `PARSER_VERSION` invalida la caché de la biblioteca: subirlo obliga a releer
  las etiquetas de todos los archivos. Solo al cambiar cómo se interpretan.
- Los metadatos se leen en segundo plano (4 workers) tras el primer render; las
  duraciones que faltan (m4a/ogg) se obtienen después con elementos `<audio>`.
- Los "álbumes" salen de la etiqueta TALB/ALBUM de cada archivo, no de la
  estructura de carpetas (las subcarpetas solo se recorren para encontrar audio).
- **Estadísticas de escucha**: `stats` en prefs (`{ruta: [nº, última vez]}`), se
  cuenta a los 20 segundos de reproducción. Alimentan los órdenes "más
  reproducidas" y "escuchadas hace poco".

## Etiquetas y nombres

- **Los nombres del archivo no se tocan solos**: si vienen codificados
  (`&quot;`, `+`, `%20`) se muestran tal cual para que el usuario vea que el
  archivo está mal, y se limpian con el botón del editor (`cleanName` en
  utils.js) o con la casilla de la edición por lotes. Fue decisión suya.
- Los textos "Artista/Álbum desconocido" que escribe metadata.js son valores de
  datos (van a la caché); solo se traducen al pintar, con `dispArtist/dispAlbum`.
- La edición por lotes escribe archivo a archivo con progreso y sigue aunque
  alguno falle; al final informa de cuántos fueron y cuántos no.
- **Portada suelta de la carpeta** (`cover.jpg`…): implementada pero apagada
  (`folderArt`, off). En carpetas con música mezclada asignaba la misma imagen a
  canciones de otros álbumes. Al reactivarla habría que exigir que las pistas de
  esa carpeta compartan álbum. Las portadas ya cacheadas con `artFromFolder` se
  ignoran mientras esté apagada.

## Audiolibros

- **Un libro es una carpeta**. `bookList()` la detecta sola (algún .m4b o el
  60% de sus pistas de más de 15 min) y el usuario puede marcarla o desmarcarla
  (`books` en prefs, con listas `yes`/`no`: lo marcado manda sobre lo
  detectado). La pestaña Libros **se muestra siempre** (con su estado vacío si no
  hay ninguno), por consistencia con Favoritos y Listas; los **ajustes** de
  libros sí siguen ocultos sin libros (`visible: hasBooks`), porque no tendrían
  a qué aplicarse.
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

## Reproducción y cola

- **Reordenar la cola**: arrastrar y soltar nativo (sin librerías), solo en las
  pistas que vienen (la que suena es el punto fijo). `moveInQueue(from, to)`
  usa offsets visibles; `to` es la posición ANTES de la cual cae, y la mitad
  inferior de una fila cuenta como "después" para poder llegar al último puesto.
  El nuevo orden se refleja en `baseQueue` por id, para que quitar el aleatorio
  lo respete. En táctil el DnD nativo no va, pero el botón de quitar sí.
- Al volver de la vista grande o de un detalle, `scrollCurrentIntoView()` deja
  la canción en curso centrada y con un destello, para no buscarla a mano.
  Además `watchCurrentRow()` (IntersectionObserver) muestra el botón flotante
  cuando esa fila se sale de pantalla, con la flecha hacia donde quedó.

## Rendimiento

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

## Interfaz

- **Una página por intención de búsqueda**, no una que lo cubra todo (rankea
  peor para las dos). La portada de `/` sigue centrada en música; `/audiolibros/`
  (y `/en/audiobooks/`) reusa la misma app con su título, descripción y titular
  propios. Es la misma aplicación: solo cambia la puerta de entrada. AppShell
  recibe `variant` y elige las claves del titular de la bienvenida; el texto de
  reserva va en español, como en el resto, e i18n lo traduce en caliente.
- **Idioma de la interfaz**: gana la preferencia guardada; si no hay, el
  `<html lang>` de la página (para que /en/ y quien la rastree vean inglés); y
  si tampoco, el del navegador. Cambiar de idioma no navega: recargaría la app
  y el usuario perdería la carpeta abierta.
- **Móvil**: no se encoge el escritorio, se reorganiza. La navegación baja a
  `.tabbar`, la cabecera queda con marca + menú (`#head-more`) y el reproductor
  es una sola fila; con la vista grande abierta, la propia barra del reproductor
  se recoloca dentro (`body.np-open .player`) para no duplicar controles.
- **Escala**: en ventanas ≥1000px se aplica `zoom: 1.1` (el tamaño que el
  usuario prefería con el zoom del navegador). `zoom` no escala vh/vw y sí
  escala la altura, así que en ese bloque se compensan `height: calc(100dvh/1.1)`
  y los máximos en vh.
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
- **Color adaptativo**: `updateAccent()` calcula el color dominante de la
  carátula (histograma de tonos en canvas 20×20) y reescribe las variables
  `--accent*` en `:root`; `resetAccent()` restaura el morado por defecto.
- CSS: existe una regla global `[hidden] { display:none !important }` porque
  las clases con `display:flex` (loader, modales) anulaban el atributo hidden.
- Logo provisional: carpeta con un play recortado (`fill-rule="evenodd"` en el
  símbolo `#i-logo`, `public/favicon.svg` y los PNG del manifest).
- Textos de la interfaz en español. Escapar siempre strings de archivos del
  usuario con `esc()` antes de inyectar en innerHTML.

## PWA

- `public/manifest.webmanifest` + `public/sw.js` (network-first para navegación,
  cache-first para assets con hash). El SW solo se registra en producción
  (`import.meta.env.PROD`). Al cambiar assets, subir la versión de `CACHE`.
