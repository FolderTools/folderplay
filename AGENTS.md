# FolderPlay

Reproductor de música local que corre 100% en el navegador. El usuario elige una
carpeta de su equipo (su "base de datos" es esa carpeta) y la app reproduce los
archivos sin subir nada a ningún servidor. Sitio estático de Astro desplegado en
Cloudflare Pages, en **folderplay.com**.

> Se llamaba *Miusic*. El nombre solo sobrevive en el proyecto de Cloudflare
> (`miusic`), porque renombrarlo obligaría a recrearlo y reconectar el dominio.
> En el código y la interfaz todo es FolderPlay.

## Dónde está cada cosa

Este archivo tiene lo que hay que saber **siempre**. El detalle está repartido, y
cada documento indica cuándo hace falta:

| Documento                                        | Léelo antes de…                                             |
| ------------------------------------------------ | ------------------------------------------------------------ |
| [docs/01-arquitectura.md](docs/01-arquitectura.md) | tocar cualquier módulo, o mover código de un archivo a otro |
| [docs/02-trampas.md](docs/02-trampas.md)         | tocar menú contextual, zoom, CSS de layout, permisos o audio |
| [docs/03-decisiones.md](docs/03-decisiones.md)   | cambiar comportamiento: libros, cola, caché, i18n, interfaz  |
| [docs/04-despliegue.md](docs/04-despliegue.md)   | desplegar. **Tiene una trampa que sube a Preview sin avisar** |

Si vas a modificar algo y no sabes por qué está así, está en `03-decisiones.md`.
Si algo se rompe de forma silenciosa, está en `02-trampas.md`.

## Node: el cambio es automático

Astro 7 exige **Node ≥ 22.12**, y el del sistema en esta máquina es 22.11.0 y
**no se toca** (otros proyectos dependen de él). El proyecto fija **22.23.1** en
`.node-version`, y fnm lo cambia solo al entrar en la carpeta.

En un shell **no interactivo** (scripts, CI, agentes) el hook no se carga y hay
que activarlo a mano, o el build falla:

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
fnm use 22.23.1
```

## Comandos

```bash
npm run dev       # servidor de desarrollo (localhost:4321)
npm run build     # build estático a dist/
npm run check     # análisis estático (lo que el build no detecta)
npm run smoke     # evalúa el bundle de dist/ sobre un DOM falso (pide build antes)
npm run deploy    # check + build + smoke + wrangler pages deploy (proyecto: miusic)
```

## La red de seguridad

**No hay tipos ni tests.** `check` y `smoke` son lo único que separa un error de
un despliegue roto. Las dos corren dentro de `npm run deploy`, y las dos tienen
que pasar antes de dar nada por terminado.

`npm run check` (`scripts/check.mjs`) comprueba seis cosas:

1. Todo `$('#id')` existe en el marcado. Si el elemento se crea con innerHTML,
   añadirlo a `DYNAMIC_IDS`.
2. Toda clave de i18n usada existe en español.
3. Todo lo que hay en español está también en los demás idiomas.
4. Ningún archivo lleva bytes nulos.
5. **Ningún identificador se usa sin declarar ni importar** (`scripts/undeclared.mjs`,
   con acorn), y ningún import sobra.
6. Ningún módulo importa de app.js y no hay ciclos de importación.

La número 5 es la que hace **seguro mover código de un archivo a otro**: al
repartir app.js, lo que se rompe es una variable que se quedó en el origen, y ni
el build ni el navegador avisan hasta que la app aparece en blanco. El análisis
da por buenas todas las declaraciones del archivo sin mirar ámbitos: prefiere
escapársele un caso de sombreado a acusar a un nombre que sí existe.

`npm run smoke` (`scripts/smoke.mjs`) evalúa el bundle ya compilado —el mismo que
sirve Cloudflare— sobre un DOM de mentira hecho con un `Proxy` que responde a
cualquier cosa. No prueba la interfaz (eso pide navegador), pero sí que todos los
módulos cargan, que no hay ciclos que dejen valores a medias y que `init()` llega
al final sin lanzar. Además captura los listeners del `<audio>` y, tras el
arranque, dispara los de progresión (`error`, `ended`, `loadedmetadata`) con el
reproductor parado. Un refactor que deje una variable sin declarar o quite una
guarda muere aquí, no en el navegador.

## Lo que no se rompe

1. **Regla de dependencias: las dependencias van hacia abajo y ningún módulo
   importa de `app.js`.** Si un módulo necesita algo de la app (repintar, cambiar
   de idioma…), llega por el contexto de su `init`, como hace `initSettings`.
   Eso es lo que evita los ciclos, y `npm run check` lo vigila. Las capas están
   en [docs/01-arquitectura.md](docs/01-arquitectura.md).
2. **Sin backend ni dependencias de runtime.** Todo es File System Access API +
   `<audio>` + object URLs. Nada de librerías para metadatos sin justificación.
3. **Nunca se copian los archivos del usuario.** Los `File` son referencias
   perezosas al disco; solo se leen los bytes de etiquetas y carátulas.
4. **El marcado no se duplica.** Todo el cuerpo está en `AppShell.astro`, que
   comparten todas las páginas e idiomas.
5. **Cero literales de texto en la interfaz.** Todo sale de una clave de i18n, en
   todos los idiomas, y `npm run check` falla si falta alguna.
6. **Escapa siempre con `esc()`** los strings que vienen de archivos del usuario
   antes de inyectarlos en innerHTML.

## Añadir cosas

- **Un idioma**: crear `src/scripts/locales/<código>.js` y registrarlo en
  `DICTS`. Nada más cambia.
- **Un ajuste**: una entrada en `SETTINGS` (`src/scripts/settings.js`) más sus
  textos `settings.<clave>` en los locales. El panel se dibuja solo.
- **Una página o variante**: un bloque en `PAGES` de `HeadMeta.astro` más su
  cáscara de cuatro líneas en `src/pages/`.
