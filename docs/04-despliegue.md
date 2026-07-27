# 04 — Despliegue

Cloudflare Pages con wrangler. Es un proyecto de "Direct Upload" con dos
dominios: `folderplay.com` (el bueno, canónico) y `miusic.pages.dev`. Requiere
HTTPS porque la File System Access API solo funciona en contextos seguros.

## La trampa de la rama

En Cloudflare la **rama de producción es `main`**; el dominio sirve solo los
despliegues de esa rama. En git, en cambio, las ramas son `prod` (por
defecto/publicada) y `develop`.

**No coinciden a propósito.** Si `wrangler pages deploy` no lleva
`--branch=main`, detecta la rama de git (`prod`) y sube a **Preview**: el
comando termina bien, no hay error, y el dominio no cambia. Por eso el script de
`deploy` fija `--branch=main`.

Comprobar con:

```bash
wrangler pages deployment list --project-name=miusic
```

y mirar la columna Environment.

## Repositorio

`github.com/FolderTools/folderplay`, público. La rama por defecto del repo es
`prod`. El README del perfil de la organización vive en otro repo,
`FolderTools/.github`, en `profile/README.md`.

## Después de desplegar

La home puede tardar unos minutos en refrescarse por la caché del edge; las
rutas nuevas salen al momento. El build local, la URL directa del despliegue
(`<hash>.miusic.pages.dev`) y `dist/` son la fuente de verdad para verificar
antes de que propague.
