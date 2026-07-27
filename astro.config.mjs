import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://folderplay.com',
  output: 'static',

  // Astro 7 cambió el valor por defecto a 'jsx', que borra el espacio entre
  // etiquetas hermanas. Aquí pega texto de verdad: el titular pasaba de
  // "…local 15 30 FolderPlay" a "…local1530FolderPlay". Todo el marcado vive en
  // un solo AppShell.astro con muchos <button>/<span>/<label> adyacentes, así que
  // se mantiene el comportamiento de siempre. No lo quites sin comparar el HTML
  // generado antes y después.
  compressHTML: true,
});
