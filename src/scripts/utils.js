// Utilidades puras: sin estado de la app ni efectos secundarios (salvo DOM query).

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '–:––';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Duraciones largas en lenguaje humano: "2 h 15 min" en vez de "135:20"
export function fmtLong(sec) {
  if (!sec || !isFinite(sec)) return '–';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.round((sec % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function hashOf(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Relleno visible de un input[type=range] vía la variable CSS --fill
export function setFill(el, pct) {
  el.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
}

export function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export function extOf(name) {
  return name.split('.').pop().toLowerCase();
}

// Limpieza de nombres que vienen codificados para URL (típico de archivos
// descargados): entidades HTML y espacios convertidos en +. Nunca se aplica
// sola: el usuario la lanza desde el editor, para que primero vea el problema.
const ENTITIES = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };

export function cleanName(text) {
  let out = String(text ?? '');

  // %20, %27, %C3%A9… (nombres sacados de una URL)
  if (/%[0-9A-Fa-f]{2}/.test(out)) {
    try {
      out = decodeURIComponent(out);
    } catch { /* secuencia inválida: se deja como está */ }
  }

  out = out
    .replace(/&(quot|apos|amp|lt|gt|nbsp);/gi, (m, key) => ENTITIES[key.toLowerCase()])
    .replace(/&#(\d{2,4});/g, (m, code) => String.fromCharCode(Number(code)));

  // Un + entre dos letras es un espacio codificado ("Its+My+Life"), pero solo
  // si se repite: así no se rompen "C++" ni "Google+" ni "Rock + Roll".
  if ((out.match(/(?<=\w)\+(?=\w)/g) || []).length >= 2) {
    out = out.replace(/(?<=\w)\+(?=\w)/g, ' ');
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}

// Portada generada: degradado estable derivado de un texto semilla
export function genArt(seed, icon = 'note') {
  const h1 = hashOf(seed) % 360;
  const h2 = (h1 + 45) % 360;
  return `<div class="gen-art" style="background:linear-gradient(135deg,hsl(${h1},52%,40%),hsl(${h2},60%,20%))">${ICON(icon, 'gen-ph')}</div>`;
}

// Deja una imagen lista para incrustarla en un MP3: los JPEG/PNG pequeños se
// usan tal cual y el resto se reescala a 800px y se recomprime, para no
// hinchar el archivo del usuario con una portada de varios megas.
export async function processCoverImage(file) {
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size < 400 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const max = 800;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
