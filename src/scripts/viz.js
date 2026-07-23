// Animación del sonido en la barra del reproductor: AnalyserNode de WebAudio
// dibujado sobre un canvas. Sin dependencias.
//
// Modos (ajuste `viz`): off | bars | line | pulse. Añadir uno = una función de
// dibujo en MODES y una opción en el registro de ajustes.
//
// El nodo de origen se crea una sola vez y en el primer play (antes el
// AudioContext nace suspendido). Si el usuario tiene desactivadas las
// animaciones, ni siquiera se enruta el audio.

import { getPref } from './prefs.js';

let audioCtx = null;
let analyser = null;
let freqBins = null;
let timeBins = null;
let canvas = null;
let ctx2d = null;
let raf = 0;
let color = '#b18cff';
// Tamaño del canvas en CSS, medido por ResizeObserver. NUNCA se lee
// clientWidth dentro del bucle de dibujo: forzaría un relayout síncrono en
// cada frame y, con miles de filas en `content-visibility`, eso hunde los fps
// a ~10. La medida solo cambia al redimensionar, así que ahí es donde se toma.
let cssW = 0;
let resizeObs = null;

export function vizMode() {
  const mode = getPref('viz', 'off');
  if (mode === 'off' || !MODES[mode]) return 'off';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
  return mode;
}

export function refreshVizColor() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim();
  if (value) color = value;
}

export function startViz(audio, el) {
  if (vizMode() === 'off') return;
  canvas = el;
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqBins = new Uint8Array(analyser.frequencyBinCount);
      timeBins = new Uint8Array(analyser.fftSize);
      // El audio pasa por WebAudio: si el contexto se suspende, no sonaría.
      audioCtx.onstatechange = () => {
        if (audioCtx.state === 'suspended' && !audio.paused) audioCtx.resume().catch(() => {});
      };
    } catch {
      audioCtx = null; // navegador sin WebAudio utilizable: la app sigue igual
      return;
    }
  }
  audioCtx.resume?.().catch(() => {});
  ctx2d = canvas.getContext('2d');
  refreshVizColor();
  // El ResizeObserver mide fuera del bucle: sus llamadas van sincronizadas con
  // el layout del navegador y no provocan thrashing.
  if (!resizeObs) {
    resizeObs = new ResizeObserver(() => measure());
    resizeObs.observe(canvas);
  }
  measure(); // primera medida antes del primer frame
  if (!raf) raf = requestAnimationFrame(draw);
}

export function stopViz() {
  cancelAnimationFrame(raf);
  raf = 0;
  resizeObs?.disconnect();
  resizeObs = null;
  cssW = 0;
  if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
}

// Ajusta el búfer del canvas a su tamaño en pantalla. Solo se llama al medir,
// nunca por frame.
function measure() {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cssW = canvas.clientWidth;
  const w = Math.round(cssW * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// Las frecuencias altas casi no tienen energía: se comprime el recorrido
const binFor = (i, total, length) => Math.floor((i / total) ** 1.35 * (length - 1));

function bar(x, y, w, h) {
  if (ctx2d.roundRect) {
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, w, h, Math.min(w, h) / 2);
    ctx2d.fill();
  } else {
    ctx2d.fillRect(x, y, w, h);
  }
}

const MODES = {
  // Espectro clásico: muchas barras subiendo desde abajo
  bars(w, h) {
    analyser.getByteFrequencyData(freqBins);
    ctx2d.fillStyle = color;
    const bars = Math.max(32, Math.min(96, Math.round(w / 14)));
    const step = w / bars;
    const barW = Math.max(2, step * 0.62);
    for (let i = 0; i < bars; i++) {
      const value = freqBins[binFor(i, bars, freqBins.length)] / 255;
      const barH = Math.max(2, value * value * h * 1.05);
      bar(i * step + (step - barW) / 2, h - barH, barW, barH);
    }
  },

  // Igual pero espejado desde el centro: el look de los equipos antiguos
  mirror(w, h) {
    analyser.getByteFrequencyData(freqBins);
    ctx2d.fillStyle = color;
    const bars = Math.max(32, Math.min(96, Math.round(w / 12)));
    const step = w / bars;
    const barW = Math.max(2, step * 0.6);
    for (let i = 0; i < bars; i++) {
      const value = freqBins[binFor(i, bars, freqBins.length)] / 255;
      const half = Math.max(1.5, value * value * h * 0.5);
      bar(i * step + (step - barW) / 2, h / 2 - half, barW, half * 2);
    }
  },

  // Onda real (osciloscopio) con el área rellena para que se vea de lejos
  line(w, h) {
    analyser.getByteTimeDomainData(timeBins);
    const step = w / (timeBins.length - 1);
    const point = (i) => {
      const value = Math.max(-1, Math.min(1, ((timeBins[i] - 128) / 128) * 2.2));
      return h / 2 + value * h * 0.46;
    };

    ctx2d.beginPath();
    ctx2d.moveTo(0, h);
    ctx2d.lineTo(0, point(0));
    for (let i = 1; i < timeBins.length; i++) ctx2d.lineTo(i * step, point(i));
    ctx2d.lineTo(w, h);
    ctx2d.closePath();
    const fill = ctx2d.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, color);
    fill.addColorStop(1, 'transparent');
    ctx2d.globalAlpha = 0.55;
    ctx2d.fillStyle = fill;
    ctx2d.fill();

    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = Math.max(2, h * 0.045);
    ctx2d.lineJoin = 'round';
    ctx2d.beginPath();
    ctx2d.moveTo(0, point(0));
    for (let i = 1; i < timeBins.length; i++) ctx2d.lineTo(i * step, point(i));
    ctx2d.stroke();
  },

  // Resplandor que late con los graves
  pulse(w, h) {
    analyser.getByteFrequencyData(freqBins);
    const bass = Math.max(4, Math.floor(freqBins.length * 0.14));
    let sum = 0;
    for (let i = 0; i < bass; i++) sum += freqBins[i];
    const level = Math.min(1, (sum / bass / 255) * 1.5);
    const radius = Math.max(h, w * 0.42) * (0.4 + level * 0.9);
    const glow = ctx2d.createRadialGradient(w / 2, h, 0, w / 2, h, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'transparent');
    ctx2d.globalAlpha = 0.3 + level * 0.7;
    ctx2d.fillStyle = glow;
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.globalAlpha = 1;
  },
};

function draw() {
  raf = requestAnimationFrame(draw);
  // cssW == 0 mientras el canvas no tenga tamaño (oculto). No se lee layout.
  if (document.hidden || !analyser || !cssW) return;
  const mode = vizMode();
  if (mode === 'off') {
    stopViz();
    return;
  }
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  MODES[mode](canvas.width, canvas.height);
}
