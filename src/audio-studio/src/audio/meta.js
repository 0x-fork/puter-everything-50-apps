// File metadata (title, artist, album, year, genre, comment): readers for the
// tag formats audio files carry and writers for the ones exports produce.
//   RIFF INFO list (WAV), ID3v2 (MP3, and the AIFF "ID3 " chunk),
//   Vorbis comments (FLAC, Ogg Opus/Vorbis), AIFF text chunks, MP4 ilst atoms.
// Documents keep metadata in state.meta as plain strings keyed by field id.

export const META_FIELDS = [
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'year', label: 'Year' },
  { id: 'genre', label: 'Genre' },
  { id: 'comment', label: 'Comment', multiline: true },
];

const IDS = META_FIELDS.map((f) => f.id);

/** Only known, non-empty, trimmed fields. */
export function cleanMeta(meta = {}) {
  const out = {};
  for (const id of IDS) {
    const v = meta?.[id];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[id] = String(v).trim();
  }
  return out;
}

export function hasMeta(meta) {
  return Object.keys(cleanMeta(meta)).length > 0;
}

const enc = new TextEncoder();
const utf8 = new TextDecoder('utf-8');

function latin1(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function strip(s) {
  return s.replace(/\0+$/, '').replace(/\0/g, ' ').trim();
}

function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u32le(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function u32be(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, false);
  return b;
}

const ascii4 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ------------------------------------------------------------------ RIFF INFO

const RIFF_KEYS = { title: 'INAM', artist: 'IART', album: 'IPRD', year: 'ICRD', genre: 'IGNR', comment: 'ICMT' };

/** LIST/INFO chunk (with header) for a WAV file, or null without metadata. */
export function riffInfoChunk(meta) {
  const m = cleanMeta(meta);
  const subs = [];
  for (const [id, key] of Object.entries(RIFF_KEYS)) {
    if (!m[id]) continue;
    const text = enc.encode(`${m[id]}\0`);
    const pad = text.length & 1;
    subs.push(concat([ascii4(key), u32le(text.length), text, new Uint8Array(pad)]));
  }
  if (!subs.length) return null;
  const body = concat([ascii4('INFO'), ...subs]);
  return concat([ascii4('LIST'), u32le(body.length), body]);
}

/** Reads INFO subchunks from the body of a LIST chunk that starts with "INFO". */
export function parseRiffInfo(bytes) {
  const out = {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keys = Object.fromEntries(Object.entries(RIFF_KEYS).map(([k, v]) => [v, k]));
  let o = 4;
  while (o + 8 <= bytes.length) {
    const id = latin1(bytes.subarray(o, o + 4));
    const size = dv.getUint32(o + 4, true);
    if (keys[id]) out[keys[id]] = strip(utf8.decode(bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size))));
    o += 8 + size + (size & 1);
  }
  return cleanMeta(out);
}

// --------------------------------------------------------------------- ID3v2

const ID3_FRAMES = { title: 'TIT2', artist: 'TPE1', album: 'TALB', year: 'TYER', genre: 'TCON' };

function id3Text(s) {
  // ISO-8859-1 when possible, else UTF-16 with a byte order mark (both v2.3-safe).
  if (/^[\x00-\xff]*$/.test(s)) return { encoding: 0, bytes: Uint8Array.from(s, (c) => c.charCodeAt(0)), nul: new Uint8Array(1) };
  const bytes = new Uint8Array(2 + s.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes[2 + i * 2] = c & 255;
    bytes[3 + i * 2] = c >> 8;
  }
  return { encoding: 1, bytes, nul: new Uint8Array(2) };
}

function syncsafe(n) {
  return Uint8Array.of((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
}

/** ID3v2.3 tag (header included), or null without metadata. `padding` bytes of zeros follow the frames. */
export function id3v2Tag(meta, { padding = 0 } = {}) {
  const m = cleanMeta(meta);
  const frames = [];
  const frame = (id, body) => frames.push(concat([ascii4(id), u32be(body.length), new Uint8Array(2), body]));
  for (const [field, id] of Object.entries(ID3_FRAMES)) {
    if (!m[field]) continue;
    const t = id3Text(m[field]);
    frame(id, concat([Uint8Array.of(t.encoding), t.bytes]));
  }
  if (m.comment) {
    const t = id3Text(m.comment);
    // encoding, language, empty short description (terminated), text
    frame('COMM', concat([Uint8Array.of(t.encoding), ascii4('eng').subarray(0, 3), t.encoding ? Uint8Array.of(0xff, 0xfe, 0, 0) : new Uint8Array(1), t.bytes]));
  }
  if (!frames.length) return null;
  const body = concat([...frames, new Uint8Array(padding)]);
  return concat([ascii4('ID3'), Uint8Array.of(3, 0, 0), syncsafe(body.length), body]);
}

function decodeId3Text(encoding, bytes) {
  if (encoding === 0) return latin1(bytes);
  if (encoding === 3) return utf8.decode(bytes);
  let le = true;
  let b = bytes;
  if (encoding === 1 && b.length >= 2) {
    if (b[0] === 0xfe && b[1] === 0xff) le = false;
    if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) b = b.subarray(2);
  } else if (encoding === 2) le = false;
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  return s;
}

/** Size in bytes of an ID3v2 tag at the start of `bytes` (0 if none). */
export function id3v2Size(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

/** Reads text fields from an ID3v2.2/2.3/2.4 tag at the start of `bytes`. */
export function parseId3v2(bytes) {
  const size = id3v2Size(bytes);
  if (!size) return {};
  const version = bytes[3];
  const flags = bytes[5];
  const end = Math.min(bytes.length, size);
  let o = 10;
  if (flags & 0x40 && version >= 3) {
    // Extended header.
    const dv = new DataView(bytes.buffer, bytes.byteOffset + o);
    o += version === 4 ? ((bytes[o] & 0x7f) << 21) | ((bytes[o + 1] & 0x7f) << 14) | ((bytes[o + 2] & 0x7f) << 7) | (bytes[o + 3] & 0x7f) : dv.getUint32(0) + 4;
  }
  const map =
    version === 2
      ? { TT2: 'title', TP1: 'artist', TAL: 'album', TYE: 'year', TCO: 'genre', COM: 'comment' }
      : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TYER: 'year', TDRC: 'year', TCON: 'genre', COMM: 'comment' };
  const idLen = version === 2 ? 3 : 4;
  const headLen = version === 2 ? 6 : 10;
  const out = {};
  while (o + headLen <= end) {
    const id = latin1(bytes.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize;
    if (version === 2) fsize = (bytes[o + 3] << 16) | (bytes[o + 4] << 8) | bytes[o + 5];
    else if (version === 4) fsize = ((bytes[o + 4] & 0x7f) << 21) | ((bytes[o + 5] & 0x7f) << 14) | ((bytes[o + 6] & 0x7f) << 7) | (bytes[o + 7] & 0x7f);
    else fsize = ((bytes[o + 4] << 24) | (bytes[o + 5] << 16) | (bytes[o + 6] << 8) | bytes[o + 7]) >>> 0;
    const body = bytes.subarray(o + headLen, Math.min(end, o + headLen + fsize));
    const field = map[id];
    if (field && body.length > 1 && !out[field]) {
      const encoding = body[0];
      let text;
      if (field === 'comment') {
        // Skip language and the short description.
        const rest = body.subarray(4);
        const wide = encoding === 1 || encoding === 2;
        let i = 0;
        if (wide) {
          while (i + 1 < rest.length && (rest[i] || rest[i + 1])) i += 2;
          i += 2;
        } else {
          while (i < rest.length && rest[i]) i++;
          i += 1;
        }
        text = decodeId3Text(encoding, rest.subarray(i));
      } else text = decodeId3Text(encoding, body.subarray(1));
      text = strip(text);
      if (field === 'genre') text = text.replace(/^\((\d+)\)$/, '$1');
      if (field === 'year') text = text.slice(0, 4);
      out[field] = text;
    }
    o += headLen + fsize;
  }
  return cleanMeta(out);
}

// ------------------------------------------------------------ Vorbis comments

const VORBIS_KEYS = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', year: 'DATE', genre: 'GENRE', comment: 'COMMENT' };

/** Vorbis comment structure (vendor string plus KEY=value list), little-endian lengths. */
export function vorbisComment(meta, vendor = 'Audio Studio') {
  const m = cleanMeta(meta);
  const v = enc.encode(vendor);
  const items = Object.entries(VORBIS_KEYS)
    .filter(([id]) => m[id])
    .map(([id, key]) => enc.encode(`${key}=${m[id]}`));
  return concat([u32le(v.length), v, u32le(items.length), ...items.flatMap((b) => [u32le(b.length), b])]);
}

export function parseVorbisComment(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  try {
    let o = 4 + dv.getUint32(0, true);
    const n = dv.getUint32(o, true);
    o += 4;
    const keys = Object.fromEntries(Object.entries(VORBIS_KEYS).map(([k, v]) => [v, k]));
    keys.DESCRIPTION = 'comment';
    keys.YEAR = 'year';
    for (let i = 0; i < n && o + 4 <= bytes.length; i++) {
      const len = dv.getUint32(o, true);
      const s = utf8.decode(bytes.subarray(o + 4, o + 4 + len));
      o += 4 + len;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      const field = keys[s.slice(0, eq).toUpperCase()];
      if (field && !out[field]) out[field] = s.slice(eq + 1);
    }
  } catch {
    // Truncated comment block: keep what was read.
  }
  if (out.year) out.year = out.year.slice(0, 4);
  return cleanMeta(out);
}

// ------------------------------------------------------------------- AIFF

const AIFF_KEYS = { title: 'NAME', artist: 'AUTH', comment: 'ANNO' };

/** NAME/AUTH/ANNO text chunks plus an "ID3 " chunk for the remaining fields. */
export function aiffMetaChunks(meta) {
  const m = cleanMeta(meta);
  const chunks = [];
  for (const [id, key] of Object.entries(AIFF_KEYS)) {
    if (!m[id]) continue;
    const text = enc.encode(m[id]);
    chunks.push(concat([ascii4(key), u32be(text.length), text, new Uint8Array(text.length & 1)]));
  }
  const tag = id3v2Tag(m);
  if (tag) chunks.push(concat([ascii4('ID3 '), u32be(tag.length), tag, new Uint8Array(tag.length & 1)]));
  return chunks;
}

// --------------------------------------------------------------- File sniffing

/**
 * Best-effort metadata from the start of a compressed file (ID3v2 for MP3,
 * Vorbis comments for FLAC and Ogg, ilst atoms for MP4). Never throws.
 */
export function readTags(buffer) {
  try {
    const b = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4 << 20));
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return parseId3v2(b);
    const head = latin1(b.subarray(0, 4));
    if (head === 'fLaC') return flacTags(b);
    if (head === 'OggS') return oggTags(b);
    if (latin1(b.subarray(4, 8)) === 'ftyp') return mp4Tags(b);
  } catch {
    // Unreadable tags never block opening the audio.
  }
  return {};
}

function flacTags(b) {
  let o = 4;
  while (o + 4 <= b.length) {
    const last = b[o] & 0x80;
    const type = b[o] & 0x7f;
    const len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    if (type === 4) return parseVorbisComment(b.subarray(o + 4, o + 4 + len));
    if (last) break;
    o += 4 + len;
  }
  return {};
}

function oggTags(b) {
  // Collect the second packet (comment header) from the first pages.
  const packets = [];
  let current = [];
  let o = 0;
  while (o + 27 <= b.length && packets.length < 2) {
    if (latin1(b.subarray(o, o + 4)) !== 'OggS') break;
    const segs = b[o + 26];
    let p = o + 27 + segs;
    for (let i = 0; i < segs; i++) {
      const len = b[o + 27 + i];
      current.push(b.subarray(p, p + len));
      p += len;
      if (len < 255) {
        packets.push(concat(current));
        current = [];
        if (packets.length >= 2) break;
      }
    }
    o = p;
  }
  const pkt = packets[1];
  if (!pkt) return {};
  const tag = latin1(pkt.subarray(0, 8));
  if (tag === 'OpusTags') return parseVorbisComment(pkt.subarray(8));
  if (pkt[0] === 3 && latin1(pkt.subarray(1, 7)) === 'vorbis') return parseVorbisComment(pkt.subarray(7));
  return {};
}

const MP4_KEYS = { '\xa9nam': 'title', '\xa9ART': 'artist', '\xa9alb': 'album', '\xa9day': 'year', '\xa9gen': 'genre', '\xa9cmt': 'comment' };

function mp4Tags(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = {};
  const walk = (start, end, path) => {
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      const type = latin1(b.subarray(o + 4, o + 8));
      let head = 8;
      if (size === 1) {
        size = Number(dv.getBigUint64(o + 8));
        head = 16;
      } else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      const inner = o + head;
      if (type === 'moov' || type === 'udta' || type === 'ilst') walk(inner, o + size, [...path, type]);
      else if (type === 'meta') walk(inner + 4, o + size, [...path, type]);
      else if (path[path.length - 1] === 'ilst' && MP4_KEYS[type]) {
        // Item atom holds a 'data' atom: size, 'data', type flags, locale, value.
        const ds = dv.getUint32(inner);
        if (latin1(b.subarray(inner + 4, inner + 8)) === 'data' && ds >= 16) out[MP4_KEYS[type]] = utf8.decode(b.subarray(inner + 16, inner + ds));
      }
      o += size;
    }
  };
  walk(0, b.length, []);
  if (out.year) out.year = out.year.slice(0, 4);
  return cleanMeta(out);
}
