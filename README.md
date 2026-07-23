<div align="center">

# 🎵 FolderPlay

**Your music and audiobooks, right in the browser.**
Nothing to install. No account. Not a single file uploaded.

[**folderplay.com**](https://folderplay.com) · [Audiobooks](https://folderplay.com/en/audiobooks/) · [Español](https://folderplay.com/)

![Astro](https://img.shields.io/badge/Astro-5-BC52EE?logo=astro&logoColor=white)
![No backend](https://img.shields.io/badge/backend-none-2ea44f)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8)
![Vanilla JS](https://img.shields.io/badge/JS-no_dependencies-f7df1e?logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

Pick a folder on your computer and FolderPlay plays what's inside —music or
audiobooks— with cover art, albums, artists, chapters, favorites and a queue.
It all happens in your browser: **there's no server and nothing leaves your
machine.**

That's the whole idea. It doesn't try to out-feature desktop players; it wins
by letting you open a folder and hit play, wherever you are and on any machine,
without handing your files to anyone.

## Why it's different

- **Actually private.** It's a static page. It uses the
  [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
  to read your folder; files are never copied or sent anywhere. You can check it
  in the code, or pull the plug on your network and watch it keep playing.
- **Zero friction.** No install, no signup, no setup. Open it, pick the folder,
  done.
- **It remembers your folder.** On Chrome/Edge a single click reopens it next
  time; metadata is cached, so your library shows up instantly.

## What it does

**Music**
- Cover art and tags read straight from the files (ID3v1/2, FLAC), no libraries
- Albums, artists, favorites, playlists and instant search
- Reorderable play queue, shuffle and repeat
- **Tag editor** that writes into the real MP3 (visible in Windows or any other
  player too) and **file deletion** from within the app
- The interface color adapts to the cover that's playing

**Audiobooks**
- Any folder with long chapters or an `.m4b` is detected as a book
- Chapters in order, speed control, 15/30 s skips and a sleep timer
- **Each book remembers where you left off**, independently
- Music and books coexist: turning on books doesn't take away the music interface

**Everything else**
- English and Spanish, with a dedicated page per language and search intent
- Installable as an app (PWA) and available offline
- System media keys and keyboard shortcuts
- Before any browser permission, a custom dialog explains what's about to happen

## How it works under the hood

A static [Astro](https://astro.build) site; at runtime it's dependency-free
JavaScript: the File System API + `<audio>` + IndexedDB for caching. The tag
parsers (ID3, FLAC) are written by hand.

The code is split by responsibility —state, UI, library, books, playback— and
backed by a small static analysis (`npm run check`) that validates DOM ids,
translation keys, imports and cycles, plus a smoke test (`npm run smoke`) that
boots the real bundle against a fake DOM. The architecture is documented in
[`CLAUDE.md`](./CLAUDE.md).

## Development

```bash
npm install
npm run dev      # dev server (localhost:4321)
npm run build    # static build to dist/
npm run check    # static analysis (ids, i18n, imports, cycles, null bytes)
npm run smoke    # evaluate the bundle against a fake DOM
```

Needs a browser with a secure context (HTTPS or `localhost`): the File System
API only works there. Chromium gets the full experience (remember folder, edit
and delete); Firefox and Safari play through the classic file picker.

## Branches

- **`prod`** — what's live on folderplay.com.
- **`develop`** — work in progress.

## License

[MIT](./LICENSE) — use it, change it and share it; just keep the copyright notice.

---

<div align="center">
<sub>Made to listen to what's yours, from anywhere, without giving your files to anyone.</sub>
</div>
