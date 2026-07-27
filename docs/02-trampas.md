# 02 — Trampas conocidas

Cada una de estas costó una sesión de depuración. Casi todas comparten la misma
firma: **no lanzan error**, simplemente algo deja de funcionar o la app aparece
en blanco. Léelo antes de tocar el área correspondiente.

## Preferencias y estado

- **Las claves de prefs son un espacio de nombres compartido.** Un ajuste del
  registro (`resume`, valor '1'/'0') y un dato de la app no pueden llamarse
  igual: al guardar el dato se pisaba el ajuste, que pasaba a leerse como
  apagado y desactivaba media función sin error visible. De ahí `lastSession`
  y `bookSpeedByDir`. `getSetting()` además valida el valor contra el tipo y
  cae al de por defecto si no encaja.
- `state.tracks` se indexa por posición y la cola guarda esos índices: al
  eliminar una canción hay que reindexar y remapear (`forgetTrack`), nunca
  hacer `splice` a secas.
- Las marcas de libro se guardan con `libraryKey(dir)` = carpeta abierta + ruta.
  Con la ruta sola, la raíz es `""` en todas las bibliotecas y una marca se
  aplicaba a la siguiente carpeta que abrieras.
- **Nada de bytes nulos literales en el código.** `libraryKey` usa `\0` como
  separador y durante un tiempo estuvo escrito como el carácter en crudo: los
  editores y `grep`/ripgrep pasaban a tratar `app.js` como binario y dejaban de
  buscar dentro. Escrito como escape el valor guardado es idéntico, así que
  las marcas de libros que ya tuviera el usuario siguen valiendo.

## Menú contextual

- **Los clics dentro del menú contextual llevan `stopPropagation()`.** Si no,
  el clic burbujea hasta `document`, que cierra el menú; y como el contenido se
  reemplaza al abrir un submenú, el elemento pulsado ya no está dentro y no hay
  forma de distinguirlo. Igual con el botón que abre el menú: se guarda en
  `menuAnchor` en vez de mantener una lista de selectores (cada botón nuevo
  llegaba roto).
- **Un submenú es un ítem cuyo `fn` vuelve a llamar a `showMenu()`** en la misma
  posición: `hideMenu()` corre antes del `fn` (en `renderMenu`), así que el menú
  se reemplaza limpio. El ítem lleva `submenu: true` para pintar el chevron `▸`.
  El menú de cada canción usa esto para "Añadir a lista": con listas creadas abre
  un submenú (con scroll si son muchas, por `max-height` + `overflow` de
  `.ctx-menu`) en vez de una entrada por lista, que lo inflaba entero. Se capturan
  `clientX/Y` y el ancla al abrir el menú, porque en el `fn` diferido
  `e.currentTarget` ya es `null`.

## Build

- **`compressHTML: true` está fijado a mano en `astro.config.mjs`.** Astro 7
  cambió el valor por defecto a `'jsx'`, que borra el espacio entre etiquetas
  hermanas. Aquí no es cosmético: el titular pasaba de "…local 15 30 FolderPlay"
  a "…local1530FolderPlay", y en la comparación del HTML generado había 122
  pares de elementos inline afectados (`button|button`, `span|span`, `span|b`,
  `input|label`…). Todo el marcado vive en un solo `AppShell.astro`, así que el
  riesgo está por todas partes. Si algún día lo quitas, compara el texto
  renderizado antes y después, no solo que el build pase.

## CSS y layout

- **Flexbox en columna**: `.content` necesita `min-height: 0`. En móvil `.layout`
  es columna y, sin eso, la lista no hace scroll y se mete bajo el reproductor.
  Cualquier contenedor flex con un hijo scrollable tiene el mismo riesgo.
- **`zoom` y coordenadas**: con `zoom` en `:root`, `clientX`/`getBoundingClientRect`
  vienen en píxeles de pantalla pero lo que se escribe en `left`/`top` se
  multiplica por el zoom. Hay que dividir (`zoomFactor()` en app.js) o el menú
  se sale de la pantalla. Igual con `height: 100dvh` (se compensa dividiendo).
- **Repintado de máscaras**: un `-webkit-mask` sobre un elemento que se repinta
  seguido (el thumb de la barra de progreso) parpadea; mejor una imagen opaca.
- **Un `<canvas>` posicionado en absoluto necesita `height` explícito.** Es un
  elemento reemplazado: con `height: auto`, `top` y `bottom` a la vez quedan
  sobredefinidos, se ignora `bottom` y se queda en sus 150px intrínsecos.
- La vista grande (#np) usa visibility+transform; sin `visibility: hidden`
  cerrada tapa la barra del reproductor (translateY(100%) la deja encima).
- Las dos flechas de "ver en grande" (la de la barra y la de la carátula) se
  actualizan en `syncExpandUi()`; si se pinta el icono en otro sitio, se queda
  apuntando siempre hacia arriba.
- Voltear un icono simétrico no comunica nada: `#i-sort` (flecha arriba y
  flecha abajo) con `scaleY(-1)` se veía idéntico y no se distinguía el orden
  ascendente del descendente. De ahí `#i-arrow-up` y la palabra al lado.

## Archivos y permisos

- El permiso readwrite se pide sobre `state.dirHandle` (la carpeta), nunca
  primero sobre un archivo hijo: Chrome lo deniega sin diálogo y consume la
  activación del usuario.
- Los diálogos propios resuelven su promesa **dentro** del clic del botón: por
  eso se puede llamar a `showDirectoryPicker()` o `requestPermission()` justo
  después del `await` sin perder la activación del usuario.
- Antes de reescribir o borrar un MP3 en reproducción hay que soltar el audio
  (`releaseCurrentFile()`): Windows bloquea el archivo abierto. Después
  `restoreCurrentFile()` reanuda en la misma posición.

## Fallos que no pueden ser mudos

- **Un detalle de libro que ya no existe se ve en blanco.** Estar en un
  `#book/<dir>` que se desmarcó (o ya no está) hace que la vista de detalle
  dereferencie un libro inexistente y quede **en blanco, sin error en consola**.
  `normalizeView()`, al principio de `render()`, limpia ese detalle (`state.detail
  = null`) y cae a la lista de Libros. La **lista** de Libros vacía, en cambio, ya
  **no** rebota a Canciones: Libros se muestra siempre (como el resto de secciones)
  y su vista tiene un estado vacío (`books.empty`) que explica qué son.
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
