// Color de acento adaptado a la carátula en reproducción: extrae el tono
// dominante y reescribe las variables --accent* de :root. Sin carátula, deriva
// un tono estable del texto semilla (mismo color que su portada generada).

import { hashOf } from './utils.js';

const VARS = ['--accent', '--accent-2', '--accent-soft', '--accent-deep'];
let token = 0;

export async function updateAccent(picture, seed) {
  const mine = ++token;
  let color = null;
  if (picture) {
    try {
      color = await dominantColor(picture);
    } catch { /* imagen ilegible */ }
  }
  if (!color) {
    color = { h: hashOf(seed) % 360, s: 55, l: 52 };
  }
  if (mine !== token) return; // ya suena otra pista
  // En tema claro el color va sobre blanco: hay que bajarlo de luminosidad o
  // los títulos resaltados no se leen.
  const light = document.documentElement.dataset.theme === 'light';
  const h = Math.round(color.h);
  const s = Math.round(Math.min(72, Math.max(38, color.s)));
  const l = light
    ? Math.round(Math.min(46, Math.max(32, color.l)))
    : Math.round(Math.min(58, Math.max(46, color.l)));
  const root = document.documentElement.style;
  root.setProperty('--accent', `hsl(${h}, ${s}%, ${l}%)`);
  root.setProperty('--accent-2', light
    ? `hsl(${h}, ${Math.min(85, s + 10)}%, ${Math.max(26, l - 8)}%)`
    : `hsl(${h}, ${Math.min(85, s + 14)}%, ${Math.min(78, l + 18)}%)`);
  root.setProperty('--accent-soft', `hsla(${h}, ${s}%, ${l}%, ${light ? 0.12 : 0.16})`);
  root.setProperty('--accent-deep', `hsl(${h}, ${s}%, ${Math.max(24, l - 14)}%)`);
}

export function resetAccent() {
  token++;
  const root = document.documentElement.style;
  for (const v of VARS) root.removeProperty(v);
}

// Histograma de tonos (12 cubetas de 30°) ponderado por saturación y
// luminosidad media, sobre una miniatura de 20×20 px.
async function dominantColor(blob) {
  const bmp = await createImageBitmap(blob);
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.05) continue;
    const s = d / (1 - Math.abs(2 * l - 1) || 1);
    let h;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    const w = s * (1 - Math.abs(l - 0.5) * 1.5);
    if (w <= 0) continue;
    const bucket = buckets[Math.floor(h / 30) % 12];
    bucket.w += w;
    bucket.h += h * w;
    bucket.s += s * w;
    bucket.l += l * w;
  }
  let best = null;
  for (const bk of buckets) {
    if (!best || bk.w > best.w) best = bk;
  }
  if (!best?.w) return null;
  return { h: best.h / best.w, s: (best.s / best.w) * 100, l: (best.l / best.w) * 100 };
}
