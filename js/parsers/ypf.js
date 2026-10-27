/* Parser arsip YPF (engine YU-RIS)
 *
 * Format (didokumentasikan ulang dari yuris_decompiler, MIT, oleh shimamura-sakura):
 *   u32 magic = 'YPF\0', u32 version (200-500), u32 numEntries, u32 headerLen,
 *   16 byte padding nol,
 *   lalu per entri: u32 nameHash, u8 nameSize,
 *     nama file: panjang = NLTrans[nameSize ^ 0xFF], byte di-XOR via tabel,
 *     lalu decode Shift-JIS,
 *   deskriptor: u8 kind, u8 comp, u32 unpackedLen, u32 packedLen,
 *     u32/u64 offset (u64 jika versi >= 470), u32 fileHash,
 *   data file di offset (terkompresi zlib bila comp != 0).
 * Hash: <265 tanpa hash; 265-469 crc32/adler32; >=470 murmurhash2(seed 0).
 */

function swapTrans(pairs) {
  const t = Array.from({ length: 256 }, (_, i) => i);
  for (const [i, j] of pairs) {
    const a = t[i];
    t[i] = t[j];
    t[j] = a;
  }
  return t;
}

const NL_SWAPS = [
  [6, 53], [9, 11], [12, 16], [13, 19], [21, 27],
  [28, 30], [32, 35], [38, 41], [44, 47],
];
const NL_TRANS_V000 = swapTrans([[3, 72], [17, 25], [46, 50], ...NL_SWAPS]);
const NL_TRANS_V500 = swapTrans([[3, 10], [17, 24], [20, 46], ...NL_SWAPS]);
const NAME_XOR_V000 = Array.from({ length: 256 }, (_, i) => i ^ 0xff);
const NAME_XOR_V290 = NAME_XOR_V000.map((c) => c ^ 0x40);
const NAME_XOR_V500 = NAME_XOR_V000.map((c) => c ^ 0x36);

/* --- hash --- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(u8) {
  let a = 1, b = 0;
  for (let i = 0; i < u8.length; i++) {
    a = (a + u8[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0);
}

export function murmurhash2(u8, seed = 0) {
  const m = 0x5bd1e995, r = 24;
  let h = (seed ^ u8.length) >>> 0;
  let i = 0;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (; i + 4 <= u8.length; i += 4) {
    let k = dv.getUint32(i, true);
    k = Math.imul(k, m);
    k ^= k >>> r;
    k = Math.imul(k, m);
    h = Math.imul(h, m);
    h ^= k;
  }
  const rem = u8.length - i;
  if (rem === 3) h ^= u8[i + 2] << 16;
  if (rem >= 2) h ^= u8[i + 1] << 8;
  if (rem >= 1) { h ^= u8[i]; h = Math.imul(h, m); }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h >>> 0;
}

async function defaultInflate(u8) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * @param {ArrayBuffer} buffer isi file .ypf
 * @param {{inflate?: (u8: Uint8Array) => Promise<Uint8Array>}} opts
 * @returns {Promise<{version:number, files:Array<{name:string,size:number,data:Uint8Array}>}>}
 */
export async function parseYpf(buffer, opts = {}) {
  const inflate = opts.inflate || defaultInflate;
  if (!(buffer instanceof ArrayBuffer)) {
    // terima juga Uint8Array/Buffer: normalisasi ke ArrayBuffer
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  if (buffer.byteLength < 32) throw new Error("File terlalu kecil untuk arsip YPF.");
  const dv = new DataView(buffer);
  const u32 = (o) => dv.getUint32(o, true);
  let off = 0;
  if (u32(off) !== 0x00465059) throw new Error("Bukan arsip YPF (magic 'YPF\\0' tidak cocok).");
  off += 4;
  const ver = u32(off); off += 4;
  if (ver < 200 || ver >= 501) throw new Error(`Versi YPF ${ver} belum didukung (200–500).`);
  const nent = u32(off); off += 4;
  off += 4; // headerLen
  off += 16; // padding

  const nlTrans = ver === 500 ? NL_TRANS_V500 : NL_TRANS_V000;
  const nameXor = ver === 290 ? NAME_XOR_V290 : ver === 500 ? NAME_XOR_V500 : NAME_XOR_V000;
  const hashName = ver < 265 ? null : ver < 470 ? crc32 : (b) => murmurhash2(b, 0);
  const hashFile = ver < 265 ? null : ver < 470 ? adler32 : (b) => murmurhash2(b, 0);
  const sjis = new TextDecoder("shift-jis");

  const entries = [];
  for (let i = 0; i < nent; i++) {
    const nameHash = u32(off); off += 4;
    const nameSize = dv.getUint8(off); off += 1;
    const nameLen = nlTrans[nameSize ^ 0xff];
    const enc = new Uint8Array(buffer, off, nameLen); off += nameLen;
    const dec = Uint8Array.from(enc, (b) => nameXor[b]);
    if (hashName && hashName(dec) !== nameHash)
      throw new Error(`Hash nama entri ke-${i + 1} tidak cocok — file mungkin rusak.`);
    const name = sjis.decode(dec);
    const kind = dv.getUint8(off);
    const comp = dv.getUint8(off + 1);
    const ul = u32(off + 2);
    const cl = u32(off + 6);
    let foff, fhash;
    if (ver >= 470) {
      foff = Number(dv.getBigUint64(off + 10, true));
      fhash = u32(off + 18);
      off += 22;
    } else {
      foff = u32(off + 10);
      fhash = u32(off + 14);
      off += 18;
    }
    entries.push({ name, kind, comp, ul, cl, foff, fhash, nameDec: dec, nameSize });
  }

  const files = [];
  for (const e of entries) {
    const raw = new Uint8Array(buffer, e.foff, e.cl);
    if (hashFile && hashFile(raw) !== e.fhash)
      throw new Error(`Hash isi file "${e.name}" tidak cocok — file mungkin rusak.`);
    const data = e.comp ? await inflate(raw) : raw.slice();
    if (data.length !== e.ul)
      throw new Error(`Ukuran "${e.name}" tidak sesuai setelah dekompresi.`);
    files.push({ name: e.name, size: data.length, data, kind: e.kind, nameDec: e.nameDec, nameSize: e.nameSize });
  }
  return { version: ver, files };
}

export const YURIS = {
  id: "yuris",
  name: "YU-RIS",
  exts: [".ypf"],
  status: "supported",
  kind: "archive",
  description: "Arsip .ypf: jelajahi isi & ekstrak file (termasuk script .ybn).",
  parse: parseYpf,
};

/* ---------- bangun ulang .ypf ---------- */

/**
 * Bangun ulang arsip .ypf dari buffer asli + penggantian data per nama entri.
 * - Byte nama & nameSize dipertahankan verbatim dari aslinya (tanpa encode ulang).
 * - Semua entri ditulis tanpa kompresi (comp=0); urutan, nama, & kind dipertahankan.
 * - nameHash/fileHash dihitung ulang sesuai versi (200-500).
 * replacements: Map nama entri -> Uint8Array (data baru, belum dikompresi).
 * @returns {Promise<Uint8Array>} arsip .ypf baru
 */
export async function rebuildYpf(originalBuffer, replacements, opts = {}) {
  const parsed = await parseYpf(originalBuffer, opts);
  const ver = parsed.version;
  const rep = replacements instanceof Map ? replacements : new Map();

  const hashName = ver < 265 ? null : ver < 470 ? crc32 : (b) => murmurhash2(b, 0);
  const hashFile = ver < 265 ? null : ver < 470 ? adler32 : (b) => murmurhash2(b, 0);
  // konstanta XOR nama (kebalikan dari tabel NAME_XOR_* saat parse)
  const xorC = ver === 290 ? 0xff ^ 0x40 : ver === 500 ? 0xff ^ 0x36 : 0xff;

  // siapkan data per entri (nama dipertahankan byte-per-byte)
  const entries = parsed.files.map((f) => {
    const r = rep.get(f.name);
    const data = r instanceof Uint8Array ? r : f.data;
    if (!f.nameDec || f.nameSize === undefined)
      throw new Error(`Entri "${f.name}" tidak punya data nama mentah — parse ulang arsipnya.`);
    const nameEnc = Uint8Array.from(f.nameDec, (b) => b ^ xorC); // byte tersimpan
    const nameHash = hashName ? hashName(f.nameDec) >>> 0 : 0;
    return { name: f.name, data, kind: f.kind || 0, nameEnc, nameSize: f.nameSize, nameHash };
  });

  const buf = [];
  const u32 = (v) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    buf.push(b);
  };
  const u64 = (v) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    buf.push(b);
  };
  const u8 = (v) => buf.push(new Uint8Array([v & 0xff]));
  const raw = (b) => buf.push(b);

  // header: magic, version, nent, headerLen (diisi belakangan), 16 pad
  raw(new Uint8Array([0x59, 0x50, 0x46, 0x00])); // 'YPF\0'
  u32(ver);
  u32(entries.length);
  const headerLenPos = buf.length;
  u32(0); // placeholder
  raw(new Uint8Array(16));

  // entri: hitung dulu panjang header entri untuk dapat offset data
  const entryHeads = entries.map((e) => {
    const eb = [];
    const eu32 = (v) => {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, v >>> 0, true);
      eb.push(b);
    };
    eu32(e.nameHash);
    eb.push(new Uint8Array([e.nameSize]));
    eb.push(e.nameEnc);
    const descLen = ver >= 470 ? 22 : 18;
    return { head: eb, descLen, entry: e };
  });
  const headLen = 32 + entryHeads.reduce((a, e) => a + e.head.reduce((x, b) => x + b.length, 0) + e.descLen, 0);
  // tulis ulang headerLen
  new DataView(buf[headerLenPos].buffer).setUint32(0, headLen >>> 0, true);

  let off = headLen;
  for (const { head, entry: e } of entryHeads) {
    for (const b of head) raw(b);
    u8(e.kind); // kind dipertahankan dari aslinya
    u8(0); // comp = 0 (tanpa kompresi)
    u32(e.data.length); // ul
    u32(e.data.length); // cl
    if (ver >= 470) u64(off); else u32(off);
    u32(hashFile ? hashFile(e.data) >>> 0 : 0);
    off += e.data.length;
  }
  for (const { entry: e } of entryHeads) raw(e.data);

  const total = buf.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of buf) { out.set(b, p); p += b.length; }
  return out;
}
