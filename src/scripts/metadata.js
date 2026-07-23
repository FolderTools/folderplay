// Lectura de metadatos de audio 100% en el navegador (sin librerías).
// Soporta: ID3v2.2/2.3/2.4 e ID3v1 (mp3, wav, aiff), FLAC (Vorbis comments + PICTURE).
// Para otros formatos (m4a, ogg, opus) se usa el nombre de archivo como respaldo
// y la duración se obtiene después con un elemento <audio>.

const td = {
  latin1: new TextDecoder('windows-1252'),
  utf8: new TextDecoder('utf-8'),
  utf16le: new TextDecoder('utf-16le'),
  utf16be: new TextDecoder('utf-16be'),
};

async function readBytes(file, start, length) {
  const buf = await file.slice(start, start + length).arrayBuffer();
  return new Uint8Array(buf);
}

function syncsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function u32(b, i) {
  return (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
}

function decodeText(bytes, encoding) {
  if (!bytes.length) return '';
  let text;
  if (encoding === 0) text = td.latin1.decode(bytes);
  else if (encoding === 3) text = td.utf8.decode(bytes);
  else if (encoding === 2) text = td.utf16be.decode(bytes);
  else {
    // UTF-16 con BOM
    if (bytes[0] === 0xfe && bytes[1] === 0xff) text = td.utf16be.decode(bytes.subarray(2));
    else text = td.utf16le.decode(bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2) : bytes);
  }
  return text.replace(/\0+$/g, '').replace(/^\0+/g, '').trim();
}

// Busca el terminador nulo según la codificación (2 bytes para UTF-16).
function findTerminator(bytes, start, encoding) {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return { end: i, next: i + 2 };
    }
  } else {
    for (let i = start; i < bytes.length; i++) {
      if (bytes[i] === 0) return { end: i, next: i + 1 };
    }
  }
  return { end: bytes.length, next: bytes.length };
}

const V22_MAP = { TT2: 'TIT2', TP1: 'TPE1', TAL: 'TALB', TRK: 'TRCK', TCO: 'TCON', PIC: 'APIC' };

// Los géneros antiguos vienen como número, "(17)" o "(17)Rock": se traducen
// con la tabla estándar de ID3v1 (los 80 primeros cubren casi todo).
const ID3V1_GENRES = ('Blues,Classic Rock,Country,Dance,Disco,Funk,Grunge,Hip-Hop,Jazz,Metal,New Age,Oldies,Other,Pop,R&B,Rap,'
  + 'Reggae,Rock,Techno,Industrial,Alternative,Ska,Death Metal,Pranks,Soundtrack,Euro-Techno,Ambient,Trip-Hop,Vocal,Jazz+Funk,'
  + 'Fusion,Trance,Classical,Instrumental,Acid,House,Game,Sound Clip,Gospel,Noise,Alt. Rock,Bass,Soul,Punk,Space,Meditative,'
  + 'Instrumental Pop,Instrumental Rock,Ethnic,Gothic,Darkwave,Techno-Industrial,Electronic,Pop-Folk,Eurodance,Dream,'
  + 'Southern Rock,Comedy,Cult,Gangsta Rap,Top 40,Christian Rap,Pop/Funk,Jungle,Native American,Cabaret,New Wave,Psychedelic,'
  + 'Rave,Showtunes,Trailer,Lo-Fi,Tribal,Acid Punk,Acid Jazz,Polka,Retro,Musical,Rock & Roll,Hard Rock').split(',');

function normalizeGenre(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  const numeric = value.match(/^\((\d+)\)\s*(.*)$/);
  if (numeric) {
    if (numeric[2]) return numeric[2].trim();
    value = numeric[1];
  }
  if (/^\d+$/.test(value)) return ID3V1_GENRES[Number(value)] || '';
  return value;
}

async function parseId3v2(file) {
  const head = await readBytes(file, 0, 10);
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const version = head[3];
  const flags = head[5];
  const tagSize = syncsafe(head, 6);
  if (tagSize <= 0 || tagSize > file.size) return null;

  const body = await readBytes(file, 10, tagSize);
  const out = { tagSize: tagSize + 10 };
  let pos = 0;

  // Saltar cabecera extendida (v2.3 usa tamaño normal, v2.4 syncsafe)
  if (flags & 0x40) {
    const extSize = version === 4 ? syncsafe(body, 0) : u32(body, 0) + 4;
    pos += extSize;
  }

  const idLen = version === 2 ? 3 : 4;
  const headLen = version === 2 ? 6 : 10;

  while (pos + headLen <= body.length) {
    if (body[pos] === 0) break; // relleno
    let id = '';
    for (let i = 0; i < idLen; i++) id += String.fromCharCode(body[pos + i]);
    let size;
    if (version === 2) size = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
    else if (version === 4) size = syncsafe(body, pos + 4);
    else size = u32(body, pos + 4);
    if (size <= 0 || pos + headLen + size > body.length) break;

    const frameId = version === 2 ? V22_MAP[id] || id : id;
    const data = body.subarray(pos + headLen, pos + headLen + size);

    if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB' || frameId === 'TRCK' || frameId === 'TCON') {
      const value = decodeText(data.subarray(1), data[0]);
      if (frameId === 'TIT2') out.title = value;
      else if (frameId === 'TPE1') out.artist = value;
      else if (frameId === 'TALB') out.album = value;
      else if (frameId === 'TRCK') out.track = parseInt(value, 10) || null;
      else if (frameId === 'TCON') out.genre = normalizeGenre(value);
    } else if (frameId === 'APIC' && !out.picture) {
      try {
        const enc = data[0];
        let mime, cursor;
        if (version === 2) {
          // v2.2: 3 bytes de formato de imagen (ej. "JPG")
          const fmt = String.fromCharCode(data[1], data[2], data[3]).toLowerCase();
          mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
          cursor = 4;
        } else {
          const mimeEnd = findTerminator(data, 1, 0);
          mime = td.latin1.decode(data.subarray(1, mimeEnd.end)) || 'image/jpeg';
          cursor = mimeEnd.next;
        }
        cursor += 1; // tipo de imagen
        const descEnd = findTerminator(data, cursor, enc);
        const pic = data.slice(descEnd.next);
        if (pic.length > 32) out.picture = new Blob([pic], { type: mime });
      } catch { /* carátula corrupta: se ignora */ }
    }
    pos += headLen + size;
  }
  return out;
}

async function parseId3v1(file) {
  if (file.size < 128) return null;
  const b = await readBytes(file, file.size - 128, 128);
  if (b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return null; // "TAG"
  const text = (start, len) => td.latin1.decode(b.subarray(start, start + len)).replace(/\0.*$/, '').trim();
  return { title: text(3, 30), artist: text(33, 30), album: text(63, 30) };
}

const MP3_BITRATES = {
  // [versionKey][bitrateIndex] en kbps, Layer III
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// Duración de mp3: cabecera Xing/Info (VBR exacto) o estimación por bitrate (CBR).
async function mp3Duration(file, tagSize) {
  const chunk = await readBytes(file, tagSize, Math.min(8192, file.size - tagSize));
  for (let i = 0; i + 4 < chunk.length; i++) {
    if (chunk[i] !== 0xff || (chunk[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (chunk[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (chunk[i + 1] >> 1) & 0x03;
    const bitrateIdx = (chunk[i + 2] >> 4) & 0x0f;
    const rateIdx = (chunk[i + 2] >> 2) & 0x03;
    if (versionBits === 1 || layerBits !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) continue;

    const mpeg1 = versionBits === 3;
    const sampleRate = MP3_RATES[versionBits][rateIdx];
    const bitrate = MP3_BITRATES[mpeg1 ? 1 : 2][bitrateIdx] * 1000;
    const channelMode = (chunk[i + 3] >> 6) & 0x03;
    const mono = channelMode === 3;

    // Cabecera Xing/Info dentro del primer frame
    const xingOff = i + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    if (xingOff + 16 < chunk.length) {
      const tag = String.fromCharCode(chunk[xingOff], chunk[xingOff + 1], chunk[xingOff + 2], chunk[xingOff + 3]);
      if (tag === 'Xing' || tag === 'Info') {
        const xflags = u32(chunk, xingOff + 4);
        if (xflags & 0x01) {
          const frames = u32(chunk, xingOff + 8);
          const samplesPerFrame = mpeg1 ? 1152 : 576;
          return (frames * samplesPerFrame) / sampleRate;
        }
      }
    }
    // CBR: estimación por tamaño
    return ((file.size - tagSize) * 8) / bitrate;
  }
  return null;
}

async function parseFlac(file) {
  const magic = await readBytes(file, 0, 4);
  if (td.latin1.decode(magic) !== 'fLaC') return null;
  const out = {};
  let pos = 4;
  for (let guard = 0; guard < 64; guard++) {
    const bh = await readBytes(file, pos, 4);
    if (bh.length < 4) break;
    const last = bh[0] & 0x80;
    const type = bh[0] & 0x7f;
    const size = (bh[1] << 16) | (bh[2] << 8) | bh[3];
    const dataStart = pos + 4;

    if (type === 0 && size >= 18) {
      const b = await readBytes(file, dataStart, 18);
      const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const totalSamples = ((b[13] & 0x0f) * 4294967296) + (b[14] * 16777216) + (b[15] * 65536) + (b[16] * 256) + b[17];
      if (sampleRate > 0 && totalSamples > 0) out.duration = totalSamples / sampleRate;
    } else if (type === 4) {
      const b = await readBytes(file, dataStart, size);
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let p = 0;
      const vendorLen = dv.getUint32(p, true); p += 4 + vendorLen;
      const count = dv.getUint32(p, true); p += 4;
      for (let i = 0; i < count && p + 4 <= b.length; i++) {
        const len = dv.getUint32(p, true); p += 4;
        const entry = td.utf8.decode(b.subarray(p, p + len)); p += len;
        const eq = entry.indexOf('=');
        if (eq < 0) continue;
        const key = entry.slice(0, eq).toUpperCase();
        const value = entry.slice(eq + 1).trim();
        if (key === 'TITLE') out.title = value;
        else if (key === 'ARTIST' && !out.artist) out.artist = value;
        else if (key === 'ALBUM') out.album = value;
        else if (key === 'TRACKNUMBER') out.track = parseInt(value, 10) || null;
        else if (key === 'GENRE') out.genre = normalizeGenre(value);
      }
    } else if (type === 6 && !out.picture && size < 15 * 1024 * 1024) {
      const b = await readBytes(file, dataStart, size);
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let p = 4;
      const mimeLen = dv.getUint32(p); p += 4;
      const mime = td.latin1.decode(b.subarray(p, p + mimeLen)); p += mimeLen;
      const descLen = dv.getUint32(p); p += 4 + descLen;
      p += 16; // ancho, alto, profundidad, colores
      const dataLen = dv.getUint32(p); p += 4;
      if (dataLen > 32 && p + dataLen <= b.length) {
        out.picture = new Blob([b.slice(p, p + dataLen)], { type: mime || 'image/jpeg' });
      }
    }

    pos = dataStart + size;
    if (last) break;
  }
  return Object.keys(out).length ? out : null;
}

// El nombre se respeta tal cual está en el disco (aunque venga con &quot; o +):
// así se ve que el archivo está mal nombrado. Limpiarlo es una acción manual
// del editor (cleanName en utils.js).
// "01 - Artista - Título.mp3" / "Artista - Título.mp3" / "Título.mp3"
function fromFilename(name) {
  let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  base = base.replace(/^\d{1,3}[\s.\-]+(?=\S)/, '');
  const parts = base.split(' - ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { title: base };
}

export async function parseMetadata(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let meta = null;
  try {
    if (ext === 'flac') {
      meta = await parseFlac(file);
    } else if (ext === 'mp3' || ext === 'wav' || ext === 'aif' || ext === 'aiff') {
      meta = await parseId3v2(file);
      if (ext === 'mp3') {
        if (!meta || !meta.title) {
          const v1 = await parseId3v1(file);
          if (v1) meta = { ...v1, ...(meta || {}), title: meta?.title || v1.title };
        }
        try {
          const dur = await mp3Duration(file, meta?.tagSize || 0);
          if (dur) meta = { ...(meta || {}), duration: dur };
        } catch { /* duración se resolverá con <audio> */ }
      }
    }
  } catch { /* archivo corrupto o sin etiquetas */ }

  const fallback = fromFilename(file.name);
  return {
    title: meta?.title || fallback.title || file.name,
    artist: meta?.artist || fallback.artist || 'Artista desconocido',
    album: meta?.album || 'Álbum desconocido',
    genre: meta?.genre || '',
    track: meta?.track || null,
    duration: meta?.duration || null,
    picture: meta?.picture || null,
  };
}
