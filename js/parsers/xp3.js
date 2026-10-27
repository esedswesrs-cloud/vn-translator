/* Parser arsip XP3 (engine Kirikiri)
 *
 * Format (dari dokumentasi GARbro MIT & krkr-xp3):
 *   magic 11 byte: 'XP3' 0D 0A 20 0A 1A 8B 67 01
 *   u64 offset index (di 0x0B)
 *   index: u8 flag (0x80 = lanjut ke offset lain, 0x01 = zlib, 0x00 = mentah)
 *   entri: [chunk enkripsi opsional] 'File' + chunk time/adlr/segm/info
 *   info: u32 flags (bit 31 = terenkripsi), u64 ukuran, u64 ukuran packed,
 *         u16 panjang nama (karakter), nama UTF-16LE + null
 *   segm: tiap 28 byte = u8 compressed, 3 pad, u64 offset, u64 size, u64 packed
 *
 * v1: hanya arsip TANPA enkripsi. File terenkripsi ditolak dengan pesan jelas.
 */

const MAGIC = [0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01];
const FLAG_ENCRYPTED = 0x80000000;

const utf16 = new TextDecoder("utf-16le");

async function defaultInflate(u8) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function ascii4(dv, off) {
  return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
}

/**
 * Baca indeks arsip XP3 saja (tanpa mengekstrak data).
 * Berguna untuk lab dekripsi: nama & flag enkripsi tiap entri tetap terbaca
 * walau isi file-nya terenkripsi.
 * @returns {Promise<{entries: Array<{name: string, encrypted: boolean, segments: Array}>}>}
 */
export async function parseXp3Index(buffer, opts = {}) {
  const inflate = opts.inflate || defaultInflate;
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const u8 = new Uint8Array(buffer);
  if (u8.length < 19) throw new Error("File terlalu kecil untuk arsip XP3.");
  for (let i = 0; i < MAGIC.length; i++) {
    if (u8[i] !== MAGIC[i]) throw new Error("Bukan arsip XP3 (magic tidak cocok).");
  }
  return _parseIndex(buffer, inflate);
}

async function _parseIndex(buffer, inflate) {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 19) throw new Error("File terlalu kecil untuk arsip XP3.");
  for (let i = 0; i < MAGIC.length; i++) {
    if (u8[i] !== MAGIC[i]) throw new Error("Bukan arsip XP3 (magic tidak cocok).");
  }
  const dv = new DataView(buffer);
  const u64 = (o) => Number(dv.getBigUint64(o, true));

  // --- baca index ---
  let idxOff = u64(0x0b);
  if (idxOff >= u8.length) throw new Error("Offset index XP3 di luar file.");
  let flag = dv.getUint8(idxOff);
  if (flag === 0x80) {
    idxOff = u64(idxOff + 9);
    if (idxOff >= u8.length) throw new Error("Offset index XP3 di luar file.");
    flag = dv.getUint8(idxOff);
  }
  let index;
  if (flag === 0x01) {
    const packedSize = u64(idxOff + 1);
    const unpackedSize = u64(idxOff + 9);
    const packed = new Uint8Array(buffer, idxOff + 17, packedSize);
    index = await inflate(packed);
    if (index.length !== unpackedSize) throw new Error("Ukuran index XP3 tidak sesuai setelah dekompresi.");
  } else if (flag === 0x00) {
    const size = u64(idxOff + 1);
    index = new Uint8Array(buffer, idxOff + 9, size);
  } else {
    throw new Error(`Flag index XP3 tak dikenal (0x${flag.toString(16)}).`);
  }

  // --- parse entri ---
  const idv = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const iu64 = (o) => Number(idv.getBigUint64(o, true));
  const entries = [];
  let p = 0;
  while (p < index.length) {
    // chunk enkripsi opsional (nama != 'File')
    let chunkName = ascii4(idv, p);
    if (chunkName !== "File") {
      // 'eliF' dsb: u64 size, u32 adler, u16 path_len, nama + null
      const size = iu64(p + 4);
      p += 4 + 8 + size;
      chunkName = ascii4(idv, p);
      if (chunkName !== "File") throw new Error("Struktur entri XP3 tak dikenal.");
    }
    const entrySize = iu64(p + 4);
    const end = p + 12 + entrySize;
    if (end > index.length) throw new Error("Entri XP3 melebihi index.");
    p += 12;
    let name = null, encrypted = false, hash = null, segments = [];
    while (p < end) {
      const sec = ascii4(idv, p);
      const secSize = iu64(p + 4);
      const secEnd = p + 12 + secSize;
      if (sec === "adlr") {
        if (secSize >= 4) hash = idv.getUint32(p + 12, true) >>> 0;
      } else if (sec === "info") {
        const flags = idv.getUint32(p + 12, true);
        encrypted = (flags & FLAG_ENCRYPTED) !== 0;
        const nameLen = idv.getUint16(p + 12 + 4 + 8 + 8, true); // jumlah karakter
        const nameBytes = new Uint8Array(index.buffer, index.byteOffset + p + 12 + 4 + 8 + 8 + 2, nameLen * 2);
        name = utf16.decode(nameBytes);
      } else if (sec === "segm") {
        const n = Math.floor(secSize / 28);
        for (let i = 0; i < n; i++) {
          const sp = p + 12 + i * 28;
          segments.push({
            compressed: idv.getUint8(sp) !== 0,
            offset: iu64(sp + 4),
            size: iu64(sp + 12),
            packedSize: iu64(sp + 20),
          });
        }
      }
      // 'time' & 'adlr' dilewati
      p = secEnd;
    }
    if (name === null) throw new Error("Entri XP3 tanpa nama file.");
    entries.push({ name, encrypted, hash, segments });
    p = end;
  }
  return { entries };
}

/**
 * Ekstrak arsip XP3.
 * @param {ArrayBuffer} buffer isi file .xp3
 * @param {Object} opts.inflate fungsi inflate kustom
 * @param {Function} opts.decrypt hook dekripsi untuk entri terenkripsi:
 *   (entryName, segIdx, rawBytes: Uint8Array) => Uint8Array (data terdekripsi).
 *   Tanpa hook ini, entri terenkripsi melempar `ENCRYPTED::<nama>`.
 * @returns {Promise<{files: Array<{name: string, size: number, data: Uint8Array}>}>}
 */
export async function parseXp3(buffer, opts = {}) {
  const inflate = opts.inflate || defaultInflate;
  const decrypt = opts.decrypt || null;
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const u8 = new Uint8Array(buffer);
  const { entries } = await _parseIndex(buffer, inflate);

  // --- ekstrak data ---
  const files = [];
  for (const e of entries) {
    if (e.encrypted && !decrypt) {
      throw new Error(
        `ENCRYPTED::${e.name}`
      );
    }
    const parts = [];
    let total = 0;
    for (let si = 0; si < e.segments.length; si++) {
      const s = e.segments[si];
      if (s.offset + s.packedSize > u8.length) throw new Error(`Segmen "${e.name}" di luar file.`);
      let raw = new Uint8Array(buffer, s.offset, s.packedSize);
      if (e.encrypted) raw = decrypt(e.name, si, raw);
      if (!(raw instanceof Uint8Array)) throw new Error(`Hook dekripsi harus mengembalikan Uint8Array ("${e.name}").`);
      const data = s.compressed ? await inflate(raw) : raw;
      if (data.length !== s.size) throw new Error(`Ukuran segmen "${e.name}" tidak sesuai.`);
      parts.push(data);
      total += data.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of parts) { out.set(part, o); o += part.length; }
    files.push({ name: e.name, size: total, data: out });
  }
  return { files };
}

export const KIRIKIRI_XP3 = {
  id: "kirikiri-xp3",
  name: "Kirikiri (arsip .xp3)",
  exts: [".xp3"],
  status: "supported",
  kind: "archive",
  description: "Arsip .xp3: jelajahi isi & ekstrak file (termasuk .ks). Arsip terenkripsi: coba dekripsi otomatis di web.",
};

/* ---------- bangun ulang .xp3 ---------- */

function adler32u8(u8) {
  let a = 1, b = 0;
  for (let i = 0; i < u8.length; i++) {
    a = (a + u8[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0);
}

function utf16leBytes(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x10000) {
      out.push(cp & 0xff, (cp >>> 8) & 0xff);
    } else {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >>> 10), lo = 0xdc00 + (v & 0x3ff);
      out.push(hi & 0xff, (hi >>> 8) & 0xff, lo & 0xff, (lo >>> 8) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Bangun ulang arsip .xp3 dari buffer asli + penggantian data per nama entri.
 * - Hanya arsip TANPA enkripsi (parseXp3 menolak yang terenkripsi).
 * - Semua file ditulis sebagai 1 segmen tanpa kompresi; index ditulis mentah.
 * - Urutan & nama entri dipertahankan.
 * replacements: Map nama entri -> Uint8Array (data baru).
 * @returns {Promise<Uint8Array>} arsip .xp3 baru
 */
export async function rebuildXp3(originalBuffer, replacements, opts = {}) {
  const parsed = await parseXp3(originalBuffer, opts); // melempar bila ada entri terenkripsi
  const rep = replacements instanceof Map ? replacements : new Map();
  const files = parsed.files.map((f) => {
    const r = rep.get(f.name);
    return { name: f.name, data: r instanceof Uint8Array ? r : f.data };
  });

  const enc = new TextEncoder();

  // --- data file dulu, catat offset ---
  let off = 19; // magic(11) + u64 index offset
  const located = files.map((f) => ({ ...f, offset: off, offsetEnd: (off += f.data.length) }));
  const indexStart = off;

  // --- index ---
  const idxParts = [];
  const iPush = (b) => idxParts.push(b);
  const iU32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); iPush(b); };
  const iU64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); iPush(b); };
  const iU16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); iPush(b); };
  const iStr = (s) => iPush(enc.encode(s));
  for (const f of located) {
    const nameB = utf16leBytes(f.name);
    const adler = adler32u8(f.data);
    const infoSize = 4 + 8 + 8 + 2 + nameB.length;
    const entrySize = (12 + infoSize) + (12 + 28) + (12 + 4);
    iStr("File"); iU64(entrySize);
    iStr("info"); iU64(infoSize);
    iU32(0); // flags
    iU64(f.data.length); iU64(f.data.length);
    iU16(nameB.length / 2); iPush(nameB);
    iStr("segm"); iU64(28);
    iPush(new Uint8Array([0, 0, 0, 0])); // compressed=0 + padding
    iU64(f.offset); iU64(f.data.length); iU64(f.data.length);
    iStr("adlr"); iU64(4); iU32(adler);
  }
  const indexBytes = concatParts(idxParts);
  // bungkus index: u8 flag 0x00 (mentah) + u64 ukuran + entri
  const indexSection = new Uint8Array(9 + indexBytes.length);
  indexSection[0] = 0x00;
  new DataView(indexSection.buffer).setBigUint64(1, BigInt(indexBytes.length), true);
  indexSection.set(indexBytes, 9);

  // --- rakit ---
  const out = new Uint8Array(indexStart + indexSection.length);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC[i];
  new DataView(out.buffer).setBigUint64(0x0b, BigInt(indexStart), true);
  for (const f of located) out.set(f.data, f.offset);
  out.set(indexSection, indexStart);
  return out;

  function concatParts(arr) {
    const n = arr.reduce((a, b) => a + b.length, 0);
    const o = new Uint8Array(n);
    let p = 0;
    for (const c of arr) { o.set(c, p); p += c.length; }
    return o;
  }
}

/** Buat arsip .xp3 BARU dari daftar file {name, data} (untuk patch.xp3). */
export function buildXp3(files) {
  const enc = new TextEncoder();
  let off = 19; // magic(11) + u64 index offset
  const located = files.map((f) => ({ ...f, offset: off, offsetEnd: (off += f.data.length) }));
  const indexStart = off;

  const idxParts = [];
  const iPush = (b) => idxParts.push(b);
  const iU32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); iPush(b); };
  const iU64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); iPush(b); };
  const iU16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); iPush(b); };
  const iStr = (s) => iPush(enc.encode(s));
  for (const f of located) {
    const nameB = utf16leBytes(f.name);
    const adler = adler32u8(f.data);
    const infoSize = 4 + 8 + 8 + 2 + nameB.length;
    const entrySize = (12 + infoSize) + (12 + 28) + (12 + 4);
    iStr("File"); iU64(entrySize);
    iStr("info"); iU64(infoSize);
    iU32(0); // flags (tidak terenkripsi)
    iU64(f.data.length); iU64(f.data.length);
    iU16(nameB.length / 2); iPush(nameB);
    iStr("segm"); iU64(28);
    iPush(new Uint8Array([0, 0, 0, 0])); // compressed=0 + padding
    iU64(f.offset); iU64(f.data.length); iU64(f.data.length);
    iStr("adlr"); iU64(4); iU32(adler);
  }
  let n = 0;
  for (const c of idxParts) n += c.length;
  const indexBytes = new Uint8Array(n);
  let p = 0;
  for (const c of idxParts) { indexBytes.set(c, p); p += c.length; }

  const indexSection = new Uint8Array(9 + indexBytes.length);
  indexSection[0] = 0x00;
  new DataView(indexSection.buffer).setBigUint64(1, BigInt(indexBytes.length), true);
  indexSection.set(indexBytes, 9);

  const out = new Uint8Array(indexStart + indexSection.length);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC[i];
  new DataView(out.buffer).setBigUint64(0x0b, BigInt(indexStart), true);
  for (const f of located) out.set(f.data, f.offset);
  out.set(indexSection, indexStart);
  return out;
}
