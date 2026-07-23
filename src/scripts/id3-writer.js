// Escritura de etiquetas ID3v2.3 directamente en el archivo MP3 del usuario
// (File System Access API, requiere permiso de escritura). El tag se reescribe
// conservando los frames que no editamos; el audio no se toca ni se recodifica.

const PADDING = 256;

function syncsafe4(n) {
  return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
}

function syncsafeDecode(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function be4(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function latin1Bytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = Math.min(255, s.charCodeAt(i));
  return out;
}

// UTF-16LE con BOM (encoding 1 de ID3, el más compatible entre reproductores)
function utf16Bytes(s) {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
}

function frame(id, payload) {
  const out = new Uint8Array(10 + payload.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  out.set(be4(payload.length), 4);
  // flags = 0x0000
  out.set(payload, 10);
  return out;
}

function textFrame(id, text) {
  const t = utf16Bytes(text);
  const payload = new Uint8Array(1 + t.length);
  payload[0] = 0x01;
  payload.set(t, 1);
  return frame(id, payload);
}

function numFrame(id, text) {
  const t = latin1Bytes(text);
  const payload = new Uint8Array(1 + t.length);
  payload[0] = 0x00;
  payload.set(t, 1);
  return frame(id, payload);
}

function apicFrame(mime, data) {
  const m = latin1Bytes(mime);
  // encoding 0, mime\0, tipo 3 (portada frontal), descripción vacía\0, datos
  const payload = new Uint8Array(1 + m.length + 1 + 1 + 1 + data.length);
  let p = 1;
  payload.set(m, p); p += m.length;
  p += 1; // \0 del mime
  payload[p++] = 0x03;
  p += 1; // \0 de la descripción
  payload.set(data, p);
  return frame('APIC', payload);
}

// Extrae los frames existentes (v2.3/v2.4) para conservar los que no editamos.
function collectFrames(body, version, tagFlags) {
  const frames = [];
  let pos = 0;
  if (tagFlags & 0x40) {
    pos += version === 4 ? syncsafeDecode(body, 0) : ((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) + 4;
  }
  while (pos + 10 <= body.length) {
    if (body[pos] === 0) break;
    let id = '';
    for (let i = 0; i < 4; i++) id += String.fromCharCode(body[pos + i]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4
      ? syncsafeDecode(body, pos + 4)
      : (body[pos + 4] << 24) | (body[pos + 5] << 16) | (body[pos + 6] << 8) | body[pos + 7];
    if (size <= 0 || pos + 10 + size > body.length) break;
    const flags = (body[pos + 8] << 8) | body[pos + 9];
    // Solo se conservan frames sin flags (sin compresión/encriptado/unsync)
    if (flags === 0) frames.push({ id, data: body.slice(pos + 10, pos + 10 + size) });
    pos += 10 + size;
  }
  return frames;
}

const REPLACED = new Set(['TIT2', 'TPE1', 'TALB', 'TRCK', 'TCON', 'APIC']);

/**
 * Reescribe las etiquetas del MP3 en disco.
 * tags: { title, artist, album, track, picture: Blob | null }
 */
export async function writeId3(file, handle, tags) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  let audioStart = 0;
  let preserved = [];

  if (head.length === 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const version = head[3];
    const flags = head[5];
    const size = syncsafeDecode(head, 6);
    audioStart = 10 + size + ((flags & 0x10) ? 10 : 0);
    if ((version === 3 || version === 4) && !(flags & 0x80)) {
      const body = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
      preserved = collectFrames(body, version, flags);
    }
  }

  const frames = [];
  for (const f of preserved) {
    if (!REPLACED.has(f.id)) frames.push(frame(f.id, f.data));
  }
  if (tags.title) frames.push(textFrame('TIT2', tags.title));
  if (tags.artist) frames.push(textFrame('TPE1', tags.artist));
  if (tags.album) frames.push(textFrame('TALB', tags.album));
  if (tags.track) frames.push(numFrame('TRCK', String(tags.track)));
  if (tags.genre) frames.push(textFrame('TCON', tags.genre));
  if (tags.picture) {
    const data = new Uint8Array(await tags.picture.arrayBuffer());
    frames.push(apicFrame(tags.picture.type || 'image/jpeg', data));
  }

  const bodyLen = frames.reduce((a, f) => a + f.length, 0) + PADDING;
  const tag = new Uint8Array(10 + bodyLen);
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, ...syncsafe4(bodyLen)]);
  let off = 10;
  for (const f of frames) {
    tag.set(f, off);
    off += f.length;
  }

  // createWritable escribe a un archivo temporal y reemplaza al cerrar,
  // por eso es seguro leer file.slice() del original mientras se escribe.
  const writable = await handle.createWritable();
  await writable.write(new Blob([tag, file.slice(audioStart)]));
  await writable.close();
}
