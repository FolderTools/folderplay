<div align="center">

# 🎵 FolderPlay

**Tu música y tus audiolibros, directo en el navegador.**
Sin instalar nada. Sin cuenta. Sin subir un solo archivo.

[**folderplay.com**](https://folderplay.com) · [Audiolibros](https://folderplay.com/audiolibros/) · [English](https://folderplay.com/en/)

![Astro](https://img.shields.io/badge/Astro-5-BC52EE?logo=astro&logoColor=white)
![Sin backend](https://img.shields.io/badge/backend-ninguno-2ea44f)
![PWA](https://img.shields.io/badge/PWA-instalable-5A0FC8)
![Vanilla JS](https://img.shields.io/badge/JS-sin_dependencias-f7df1e?logo=javascript&logoColor=black)

</div>

---

Eliges una carpeta de tu equipo y FolderPlay reproduce lo que hay dentro —música
o audiolibros— con carátulas, álbumes, artistas, capítulos, favoritos y cola.
Todo ocurre en tu navegador: **no hay servidor y nada sale de tu ordenador.**

Esa es la idea entera. No compite con reproductores de escritorio en funciones;
compite en que abres una carpeta y suena, sin importar dónde estés ni qué equipo
uses, y sin confiar tus archivos a nadie.

## Por qué es distinto

- **Privado de verdad.** La app es una página estática. Usa la
  [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
  para leer tu carpeta; los archivos nunca se copian ni se envían a ningún sitio.
  Puedes comprobarlo en el código, o desconectar la red y ver que sigue sonando.
- **Cero fricción.** Ni instalación, ni registro, ni configuración. Entras,
  eliges la carpeta y ya.
- **Recuerda tu carpeta.** En Chrome/Edge basta un clic para reabrirla la próxima
  vez; los metadatos quedan cacheados, así que aparece al instante.

## Qué hace

**Música**
- Carátulas y etiquetas leídas de los archivos (ID3v1/2, FLAC) sin librerías
- Álbumes, artistas, favoritos, listas de reproducción y búsqueda instantánea
- Cola de reproducción reordenable, aleatorio y repetir
- **Editor de etiquetas** que escribe dentro del MP3 real (se ve también en
  Windows o cualquier reproductor) y **borrado de archivos** desde la app
- El color de la interfaz se adapta a la carátula que suena

**Audiolibros**
- Cualquier carpeta con capítulos largos o `.m4b` se detecta como libro
- Capítulos en orden, control de velocidad, saltos de 15/30 s y temporizador
- **Cada libro recuerda por dónde ibas**, de forma independiente
- La música y los libros conviven: activar libros no quita la interfaz de música

**Lo demás**
- Español e inglés, con página propia por idioma e intención de búsqueda
- Instalable como app (PWA) y disponible sin conexión
- Teclas multimedia del sistema y atajos de teclado
- Antes de cualquier permiso del navegador, un diálogo propio explica qué pasará

## Cómo funciona por dentro

Sitio estático de [Astro](https://astro.build); en tiempo de ejecución es
JavaScript sin dependencias: File System Access API + `<audio>` + IndexedDB para
la caché. Los parsers de etiquetas (ID3, FLAC) están escritos a mano.

El código está repartido por responsabilidad —estado, interfaz, biblioteca,
libros, reproducción— y se apoya en un análisis estático propio
(`npm run check`) que valida ids del DOM, claves de traducción, importaciones y
ciclos, más una prueba de humo (`npm run smoke`) que arranca el bundle real
sobre un DOM simulado. La arquitectura está documentada en
[`CLAUDE.md`](./CLAUDE.md).

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo (localhost:4321)
npm run build    # build estático a dist/
npm run check    # análisis estático (ids, i18n, imports, ciclos, bytes nulos)
npm run smoke    # evalúa el bundle sobre un DOM falso
```

Requiere un navegador con contexto seguro (HTTPS o `localhost`): la File System
Access API solo funciona ahí. Chromium tiene la experiencia completa (recordar
carpeta, editar y borrar); Firefox y Safari reproducen con el selector clásico.

## Ramas

- **`prod`** — lo que está publicado en folderplay.com.
- **`develop`** — trabajo en curso.

## Licencia

[MIT](./LICENSE) — úsalo, cámbialo y compártelo; solo conserva el aviso de copyright.

---

<div align="center">
<sub>Hecho para escuchar lo tuyo, desde donde sea, sin darle tus archivos a nadie.</sub>
</div>
