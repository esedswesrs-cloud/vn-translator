/* Lab dekripsi XP3 (engine Kirikiri) — berjalan di browser.
 *
 * Latar: banyak game doujin mengenkripsi isi file .xp3 dengan skema SEDERHANA
 * (umumnya XOR 1 byte, termasuk varian NOT = XOR 0xFF). Indeks arsip biasanya
 * TIDAK dienkripsi sehingga nama file tetap terbaca — hanya isi segmen yang
 * dikunci. Modul ini mencoba menebak kunci otomatis memakai heuristik teks:
 * file .ks adalah teks Shift-JIS, jadi kunci yang benar menghasilkan skor
 * "kemiripan teks" yang jauh lebih tinggi daripada 255 kunci yang salah.
 *
 * Batasan jujur: skema multi-byte / kunci per game yang kompleks TIDAK akan
 * tertangkap. Kalau tidak ada kandidat yang meyakinkan, lab melapor apa adanya.
 */

import { parseXp3Index } from "./xp3.js";

const sjisDecoder = new TextDecoder("shift-jis");
const utf16leDecoder = new TextDecoder("utf-16le");

/** Skor UTF-16LE: BOM FF FE atau pola (byte teks, 0x00) berulang. */
export function scoreUtf16le(u8) {
  if (!u8 || u8.length < 4) return 0;
  let off = 0, bonus = 0;
  const hasBom = u8[0] === 0xff && u8[1] === 0xfe;
  if (hasBom) { off = 2; bonus = 0.15; }
  let ok = 0, total = 0, asciiPairs = 0;
  for (let i = off; i + 1 < u8.length; i += 2) {
    const lo = u8[i], hi = u8[i + 1];
    total++;
    if (hi === 0x00) {
      if (lo === 0x0a || lo === 0x0d || lo === 0x09 || (lo >= 0x20 && lo <= 0x7e)) { ok++; asciiPairs++; }
    } else if (lo !== 0x00) {
      ok += 0.7; // kemungkinan CJK/fullwidth
    }
  }
  if (!total) return 0;
  // Data acak lolos ~0.69 hanya via kredit CJK — nyaris menyentuh ambang lab
  // (0.7) dan menimbulkan false positive. UTF-16LE asli hampir selalu memuat
  // karakter ASCII (newline/spasi/tanda baca); tanpa BOM + minim pasangan
  // ASCII, tolak sebagai tebakan lemah.
  if (!hasBom && asciiPairs / total < 0.05) return Math.min(0.5, ok / total);
  return Math.min(1, ok / total + bonus);
}

/** Skor teks multi-encoding: { score, encoding } terbaik dari SJIS vs UTF-16LE. */
export function scoreText(u8) {
  const sSjis = scoreSjisText(u8);
  const sU16 = scoreUtf16le(u8);
  if (sU16 > sSjis) return { score: sU16, encoding: "utf-16le" };
  return { score: sSjis, encoding: "shift-jis" };
}

function decodePreview(text, encoding) {
  const raw = text.subarray(0, 400);
  let s = (encoding === "utf-16le" ? utf16leDecoder : sjisDecoder).decode(raw);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

async function defaultInflate(u8) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** XOR 1 byte — mengembalikan buffer baru. */
export function xor1b(u8, key) {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ key;
  return out;
}

/* ---------- Skema turunan hash (katalog GARbro, tanpa kunci eksternal) ----------
 * Banyak game Kirikiri memakai kunci yang diturunkan dari hash adler32 entri
 * (chunk "adlr" di indeks — terbaca tanpa kunci). Di bawah ini varian yang
 * terdokumentasi di GARbro (CryptAlgorithms.cs). */
function xorEach(u8, key, skip = 0) {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = i < skip ? u8[i] : (u8[i] ^ key);
  return out;
}

function ror8(x, s) {
  s &= 7;
  return s ? (((x >>> s) | (x << (8 - s))) & 0xff) : (x & 0xff);
}

function repeatKey(u8, keyBytes) {
  const out = new Uint8Array(u8.length);
  const n = keyBytes.length;
  for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ keyBytes[i % n];
  return out;
}

const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

export const HASH_SCHEMES = [
  { id: "hash", name: "HashCrypt", fn: (u8, h) => xorEach(u8, h & 0xff) },
  { id: "sourire", name: "SourireCrypt", fn: (u8, h) => xorEach(u8, (h ^ 0xcd) & 0xff) },
  { id: "natsupochi", name: "NatsupochiCrypt", fn: (u8, h) => xorEach(u8, (h >>> 3) & 0xff) },
  { id: "hybrid", name: "HybridCrypt", fn: (u8, h) => xorEach(u8, (h >>> 5) & 0xff) },
  { id: "applique", name: "AppliqueCrypt", fn: (u8, h) => xorEach(u8, (h >>> 12) & 0xff, 5) },
  { id: "festival", name: "FestivalCrypt", fn: (u8, h) => xorEach(u8, (~(h >>> 7)) & 0xff) },
  {
    id: "yuzu", name: "YuzuCrypt", fn: (u8, h) => {
      const x = (h ^ 0x1ddb6e7a) >>> 0;
      let k = (x & 0xff) ^ ((x >>> 8) & 0xff) ^ ((x >>> 16) & 0xff) ^ ((x >>> 24) & 0xff);
      if (k === 0) k = 0xd0;
      return xorEach(u8, k);
    },
  },
  { id: "haikuo", name: "HaikuoCrypt", fn: (u8, h) => xorEach(u8, (h ^ (h >>> 8)) & 0xff) },
  { id: "poringsoft", name: "PoringSoftCrypt", fn: (u8, h) => xorEach(u8, (~(h + 1)) & 0xff) },
  {
    id: "exa", name: "ExaCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      h >>>= 0;
      for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ ((h >>> (i % 5)) & 0xff);
      return out;
    },
  },
  {
    id: "highrunning", name: "HighRunningCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      const kb = (h >>> 0) & 0xff;
      for (let i = 0; i < u8.length; i++) out[i] = (kb !== 0 && i % kb === 0) ? u8[i] : (u8[i] ^ kb);
      return out;
    },
  },
  {
    id: "hibiki", name: "HibikiCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      h >>>= 0;
      for (let i = 0; i < u8.length; i++) {
        const k = (i <= 0x64) ? (h >>> 5) : ((i & 4) ? (h >>> 8) : (h >>> 5));
        out[i] = u8[i] ^ (k & 0xff);
      }
      return out;
    },
  },
  {
    id: "okiba", name: "OkibaCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      h >>>= 0;
      for (let i = 0; i < u8.length; i++) {
        out[i] = i < 0x65 ? (u8[i] ^ ((h >>> 4) & 0xff)) : (u8[i] ^ ((h >>> ((i % 4) * 8)) & 0xff));
      }
      return out;
    },
  },
  {
    id: "damegane", name: "DameganeCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      const kb = (h >>> 0) & 0xff;
      for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ ((i % 2 === 0) ? kb : (i & 0xff));
      return out;
    },
  },
  {
    id: "damegane2", name: "DameganeCrypt (v2)", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      const kb = (h >>> 0) & 0xff;
      for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ ((i % 2 === 0) ? (i & 0xff) : kb);
      return out;
    },
  },
  {
    id: "flyingshine", name: "FlyingShineCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      h >>>= 0;
      const key = h & 0xff, sh = (h >>> 16) & 7;
      for (let i = 0; i < u8.length; i++) out[i] = ror8(u8[i] ^ key, sh);
      return out;
    },
  },
  {
    id: "seiten", name: "SeitenCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      h >>>= 0;
      for (let i = 0; i < u8.length; i++) {
        const k = (h ^ i) >>> 0, kb = k & 0xff;
        out[i] = (k & 1) ? (u8[i] ^ kb) : ((k & 2) ? ((u8[i] + kb) & 0xff) : ((u8[i] - kb) & 0xff));
      }
      return out;
    },
  },
  {
    id: "dieselmine", name: "DieselmineCrypt", fn: (u8, h) => {
      // Semua range pakai XOR (decrypt==encrypt di GARbro) dengan pengali 21/-32/43/-54.
      const out = new Uint8Array(u8.length);
      const kb = (h >>> 0) & 0xff;
      const k = [(21 * kb) & 0xff, (-32 * kb) & 0xff, (43 * kb) & 0xff, (-54 * kb) & 0xff];
      for (let i = 0; i < u8.length; i++) {
        const r = i < 123 ? 0 : i < 246 ? 1 : i < 369 ? 2 : 3;
        out[i] = u8[i] ^ k[r];
      }
      return out;
    },
  },
  {
    id: "kiss", name: "KissCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      const k = ((h >>> 0) ^ ((h >>> 0) >>> 19) ^ 0x4a9eeff0) >>> 0;
      for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ ((k ^ (i + (i & 15))) & 0xff);
      return out;
    },
  },
  {
    id: "rhapsody", name: "RhapsodyCrypt", fn: (u8, h) => {
      const out = new Uint8Array(u8.length);
      h >>>= 0;
      const key = new Uint8Array(12);
      const words = [h, 0x6e1da9b2, 0x0040c800];
      for (let w = 0; w < 3; w++) for (let b = 0; b < 4; b++) key[w * 4 + b] = (words[w] >>> (b * 8)) & 0xff;
      for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ key[i % 12];
      return out;
    },
  },
  {
    id: "tokidoki", name: "TokidokiCrypt", fn: (u8, h, ext) => {
      const out = new Uint8Array(u8.length);
      const eb = new TextEncoder().encode((ext || "").slice(0, 4));
      let x = 0;
      for (let b = 0; b < 4; b++) x |= (b < eb.length ? eb[b] : 0) << (b * 8);
      x = (~x) >>> 0;
      const n = Math.min(u8.length, 0x100);
      for (let i = 0; i < n; i++) out[i] = u8[i] ^ ((x >>> ((i & 3) * 8)) & 0xff);
      out.set(u8.subarray(n), n);
      return out;
    },
  },
];

/* ---------- Skema turunan nama file (kunci multi-byte, tanpa input user) ---------- */
const FILENAME_SCHEMES = [
  {
    id: "fname16", name: "FilenameUTF16", make: (name) => {
      const b = [];
      for (const ch of name) { const cp = ch.codePointAt(0); b.push(cp & 0xff, (cp >>> 8) & 0xff); }
      return b.length ? b : null;
    },
  },
  {
    id: "fname8", name: "FilenameUTF8", make: (name) => {
      const b = new TextEncoder().encode(name);
      return b.length ? Array.from(b) : null;
    },
  },
];

export function hashSchemeById(id) {
  return HASH_SCHEMES.find((s) => s.id === id) || null;
}

/**
 * Skor 0..1: seberapa mirip byte dengan teks Shift-JIS.
 * ASCII printable + newline dihitung penuh; pasangan lead/trail SJIS dihitung
 * penuh; byte lain tidak dihitung.
 */
export function scoreSjisText(u8) {
  if (!u8 || u8.length === 0) return 0;
  let ok = 0;
  let i = 0;
  const n = u8.length;
  while (i < n) {
    const b = u8[i];
    if (b === 0x0a || b === 0x0d || b === 0x09) { ok++; i++; continue; }
    if (b >= 0x20 && b <= 0x7e) { ok++; i++; continue; }
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      const c = i + 1 < n ? u8[i + 1] : 0;
      if ((c >= 0x40 && c <= 0x7e) || (c >= 0x80 && c <= 0xfc)) { ok += 2; i += 2; continue; }
    }
    i++;
  }
  return ok / n;
}

/** Ambil sampel byte mentah segmen pertama sebuah entri (dibatasi). */
function sampleRaw(buffer, entry, maxBytes) {
  const s = entry.segments[0];
  if (!s) return null;
  const len = Math.min(s.packedSize, maxBytes);
  if (len <= 0) return null;
  return {
    raw: new Uint8Array(buffer, s.offset, len),
    compressed: s.compressed,
    full: s.packedSize <= maxBytes,
  };
}

/**
 * Analisis arsip: hitung entri terenkripsi & pilih kandidat .ks untuk dipecahkan.
 */
export async function analyzeEncryptedXp3(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const { entries } = await parseXp3Index(buffer);
  const enc = entries.filter((e) => e.encrypted);
  const segSize = (e) => (e.segments[0] ? e.segments[0].packedSize : Infinity);
  const candidates = enc
    .filter((e) => e.name.toLowerCase().endsWith(".ks"))
    .sort((a, b) => segSize(a) - segSize(b))
    .slice(0, 3)
    .map((e) => ({ name: e.name, packedSize: segSize(e) }));
  // Inventaris lengkap: nama file di indeks TIDAK terenkripsi, jadi isi
  // arsip selalu bisa dilihat walau datanya terkunci.
  const files = entries.map((e) => ({
    name: e.name,
    encrypted: e.encrypted,
    packedSize: e.segments.reduce((a, s) => a + s.packedSize, 0),
    unpackedSize: e.segments.reduce((a, s) => a + s.size, 0),
    compressed: e.segments.some((s) => s.compressed),
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { total: entries.length, encrypted: enc.length, candidates, files };
}

/** Dekripsi satu sampel dengan skema bernama (atau XOR 1 byte), kembalikan teks kandidat. */
async function tryCandidate(sample, decryptFn) {
  const dec = decryptFn(sample.raw);
  let text;
  if (sample.compressed) {
    try {
      text = await defaultInflate(dec);
    } catch {
      // urutan alternatif: inflate dulu, baru dekripsi (kompresi setelah enkripsi)
      try {
        text = decryptFn(await defaultInflate(sample.raw));
      } catch {
        return null; // skema salah -> inflate gagal
      }
    }
  } else {
    text = dec;
  }
  // KAG-scramble? descramble dulu (lapisan dalam), baru skor
  const km = kagScrambleMode(text);
  if (km >= 0) {
    let d = null;
    try { d = await descrambleKag(text); } catch { return null; }
    const { score, encoding } = scoreText(d.subarray(0, 8192));
    if (score <= 0.7) return null;
    let preview = "";
    try { preview = decodePreview(d, encoding); } catch { preview = "(gagal decode pratinjau)"; }
    return { score, preview, encoding, kagMode: km };
  }
  const { score, encoding } = scoreText(text.subarray(0, 8192));
  if (score <= 0.7) return null;
  let preview = "";
  try {
    preview = decodePreview(text, encoding);
  } catch {
    preview = "(gagal decode pratinjau)";
  }
  return { score, preview, encoding };
}

/**
 * Pecahkan SATU entri: coba skema turunan hash (tanpa kunci) + brute-force
 * XOR 1 byte (0x01..0xFF). Tiap skema diskoring heuristik teks Shift-JIS.
 * @returns {Promise<Array<{scheme:string, schemeName:string, key:number|null, score:number, preview:string}>>}
 */
export async function crackEntry(buffer, entryName, onProgress) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const { entries } = await parseXp3Index(buffer);
  const entry = entries.find((e) => e.name === entryName && e.encrypted);
  if (!entry) throw new Error(`Entri "${entryName}" tidak ditemukan / tidak terenkripsi.`);
  const MAX_SEG = 4 * 1024 * 1024;
  const sample = sampleRaw(buffer, entry, MAX_SEG);
  if (!sample) throw new Error(`Entri "${entryName}" tidak punya segmen yang bisa dibaca.`);
  if (!sample.full) throw new Error(`Segmen "${entryName}" terlalu besar untuk dianalisis (>4 MB).`);

  const results = [];
  const push = (scheme, schemeName, key, r, extra) => {
    if (r) results.push({ scheme, schemeName, key, score: r.score, preview: r.preview, encoding: r.encoding, kagMode: r.kagMode, extra: extra || null });
  };
  const ext = extOf(entry.name);

  // 0) KAG-scramble langsung (tanpa XOR) — umum di game Kirikiri modern
  if (kagScrambleMode(sample.raw) >= 0) {
    const r = await tryCandidate(sample, (raw) => raw);
    if (r && r.kagMode !== undefined) push("kag", `KAG-scramble mode ${r.kagMode}`, null, r);
  }

  // 1) skema turunan hash (kunci dari chunk adlr di indeks — tanpa input user)
  if (entry.hash !== null && entry.hash !== undefined) {
    const h = entry.hash >>> 0;
    for (const s of HASH_SCHEMES) {
      const r = await tryCandidate(sample, (raw) => s.fn(raw, h, ext));
      push(s.id, s.name, null, r);
    }
    if (onProgress) onProgress(0.1);
  }

  // 2) skema turunan nama file (kunci multi-byte berulang)
  {
    const base = entry.name.split("/").pop();
    for (const fs of FILENAME_SCHEMES) {
      for (const nm of [entry.name, base]) {
        const kb = fs.make(nm);
        if (!kb) continue;
        const r = await tryCandidate(sample, (raw) => repeatKey(raw, kb));
        push(fs.id, fs.name + (nm === base ? " (basename)" : ""), null, r, { name: nm });
      }
    }
    if (onProgress) onProgress(0.15);
  }

  // 3) brute-force XOR 1 byte
  for (let key = 1; key <= 255; key++) {
    if (key % 32 === 0 && onProgress) onProgress(0.15 + (key / 255) * 0.5);
    const r = await tryCandidate(sample, (raw) => xor1b(raw, key));
    push("xor1b", "XOR 1-byte", key, r);
  }

  // 4) brute-force obfuskasi 1-byte non-XOR: ADD/SUB + ROL
  for (let k = 1; k <= 255; k++) {
    if (k % 64 === 0 && onProgress) onProgress(0.65 + (k / 262) * 0.35);
    const r = await tryCandidate(sample, (raw) => {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - k) & 0xff;
      return out;
    });
    push("addsub", `ADD/SUB 1-byte (${k})`, k, r);
  }
  for (let rot = 1; rot <= 7; rot++) {
    if (onProgress) onProgress(0.65 + ((255 + rot) / 262) * 0.35);
    const r = await tryCandidate(sample, (raw) => {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = ((raw[i] << rot) | (raw[i] >>> (8 - rot))) & 0xff;
      return out;
    });
    push("rol", `ROL ${rot}-bit`, rot, r);
  }
  if (onProgress) onProgress(1);
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3);
}

/* ---------- Serangan known-plaintext ----------
 * File gambar/audio terenkripsi punya magic bytes yang diketahui (PNG, TLG,
 * OGG, ...). XOR cipher[0..n] dengan magic -> keystream. Bila keystream
 * berulang dengan periode kecil (kunci XOR multi-byte), kunci pulih total
 * dan langsung diuji ke sampel .ks. Menangkap SEMUA skema XOR berulang,
 * berapa pun panjang kuncinya. */
const KNOWN_MAGICS = {
  ".png": [
    { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], extra: [{ off: 12, bytes: [0x49, 0x48, 0x44, 0x52] }] },
  ],
  ".tlg": [
    { bytes: [0x54, 0x4c, 0x47, 0x35, 0x2e, 0x30, 0x00, 0x72, 0x61, 0x77, 0x1a, 0x00] },
    { bytes: [0x54, 0x4c, 0x47, 0x36, 0x2e, 0x30, 0x00, 0x72, 0x61, 0x77, 0x1a, 0x00] },
  ],
  ".ogg": [{ bytes: [0x4f, 0x67, 0x67, 0x53] }],
  ".oga": [{ bytes: [0x4f, 0x67, 0x67, 0x53] }],
  ".wav": [{ bytes: [0x52, 0x49, 0x46, 0x46] }],
};

function detectPeriod(ks) {
  // ks: Map(pos -> byte). Kembalikan periode terkecil yang konsisten, atau 0.
  const maxP = Math.floor(ks.size / 2);
  for (let p = 1; p <= maxP; p++) {
    let baseOk = true;
    for (let b = 0; b < p; b++) if (!ks.has(b)) { baseOk = false; break; }
    if (!baseOk) continue;
    let consistent = true;
    for (const [pos, val] of ks) {
      if (ks.get(pos % p) !== val) { consistent = false; break; }
    }
    if (consistent) return p;
  }
  return 0;
}

/**
 * @returns {Promise<Array<{scheme,schemeName,key,score,preview,extra}>>}
 * key = array byte kunci berulang yang pulih.
 */
export async function crackKnownPlaintext(buffer, ksNames, onProgress) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const u8 = new Uint8Array(buffer);
  const { entries } = await parseXp3Index(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const results = [];
  const seen = new Set();

  const imgEntries = entries
    .filter((e) => e.encrypted && KNOWN_MAGICS[extOf(e.name)] && e.segments.length > 0)
    .slice(0, 12);

  const samples = [];
  for (const nm of ksNames) {
    const e = byName.get(nm);
    if (!e || !e.encrypted) continue;
    const s = sampleRaw(buffer, e, 4 * 1024 * 1024);
    if (s && s.full) samples.push(s);
  }
  if (samples.length === 0 || imgEntries.length === 0) return [];

  let done = 0;
  for (const img of imgEntries) {
    const seg = img.segments[0];
    // known-plaintext butuh data mentah: lewati segmen terkompresi
    if (seg.compressed) continue;
    const head = u8.subarray(seg.offset, seg.offset + Math.min(seg.packedSize, 64));
    for (const magic of KNOWN_MAGICS[extOf(img.name)]) {
      if (head.length < magic.bytes.length) continue;
      const ks = new Map();
      let bad = false;
      const put = (pos, val) => {
        if (ks.has(pos)) { if (ks.get(pos) !== val) bad = true; }
        else ks.set(pos, val);
      };
      magic.bytes.forEach((b, i) => put(i, head[i] ^ b));
      for (const ex of magic.extra || []) {
        for (let j = 0; j < ex.bytes.length; j++) {
          if (ex.off + j >= head.length) { bad = true; break; }
          put(ex.off + j, head[ex.off + j] ^ ex.bytes[j]);
        }
      }
      if (bad || ks.size < 4) continue;
      const p = detectPeriod(ks);
      if (p <= 1) continue; // p=1 sudah dicakup brute-force XOR
      const key = [];
      for (let b = 0; b < p; b++) key.push(ks.get(b));
      const hex = key.map((x) => x.toString(16).padStart(2, "0")).join("");
      if (seen.has(hex)) continue;
      seen.add(hex);
      for (const s of samples) {
        const r = await tryCandidate(s, (raw) => repeatKey(raw, key));
        if (r) {
          results.push({
            scheme: "knownplain",
            schemeName: `Kunci berulang dari ${img.name.split("/").pop()}`,
            key, score: r.score, preview: r.preview, encoding: r.encoding, kagMode: r.kagMode,
            extra: { fromImage: img.name },
          });
        }
      }
    }
    done++;
    if (onProgress) onProgress(done / imgEntries.length);
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3);
}

/** Hook dekripsi: kunci multi-byte berulang (hasil known-plaintext). */
export function makeRepeatingKeyDecrypt(keyBytes) {
  const k = Uint8Array.from(keyBytes);
  return (entryName, segIdx, raw) => repeatKey(raw, k);
}

/** Satu pintu pembuatan hook dekripsi dari hasil crackEntry/crackKnownPlaintext. */
export async function makeDecryptorForResult(buffer, r) {
  if (r.scheme === "kag") return (entryName, segIdx, raw) => raw; // descramble sbg post-step
  if (r.scheme === "addsub") {
    const k = r.key;
    return (entryName, segIdx, raw) => {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - k) & 0xff;
      return out;
    };
  }
  if (r.scheme === "rol") {
    const n = r.key;
    return (entryName, segIdx, raw) => {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = ((raw[i] << n) | (raw[i] >>> (8 - n))) & 0xff;
      return out;
    };
  }
  if (r.scheme === "xor1b") return makeXorDecrypt(r.key);
  if (r.scheme === "knownplain" || r.scheme === "sigkey" || r.scheme === "manual" || r.scheme === "exekey") {
    return makeRepeatingKeyDecrypt(r.key);
  }
  if (r.scheme === "fname16" || r.scheme === "fname8") {
    const fs = FILENAME_SCHEMES.find((s) => s.id === r.scheme);
    const kb = fs.make(r.extra && r.extra.name ? r.extra.name : "");
    if (!kb) throw new Error("Nama file untuk kunci tidak tersedia.");
    return (entryName, segIdx, raw) => repeatKey(raw, kb);
  }
  return makeHashDecryptor(buffer, r.scheme);
}

/** Bangun hook dekripsi skema-hash (perlu baca indeks dulu untuk hash tiap entri). */
export async function makeHashDecryptor(buffer, schemeId) {
  const scheme = hashSchemeById(schemeId);
  if (!scheme) throw new Error(`Skema tak dikenal: ${schemeId}`);
  const { entries } = await parseXp3Index(buffer);
  const hashByName = new Map(entries.map((e) => [e.name, e.hash]));
  return (entryName, segIdx, raw) => {
    const h = hashByName.get(entryName);
    if (h === undefined || h === null) throw new Error(`Hash entri "${entryName}" tidak ada di indeks.`);
    return scheme.fn(raw, h >>> 0, extOf(entryName));
  };
}

/** Buat hook dekripsi parseXp3 dari kunci XOR 1 byte yang ditemukan. */
export function makeXorDecrypt(key) {
  return (entryName, segIdx, raw) => xor1b(raw, key);
}

/* ---------- Forensik: bantu diagnosis cipher via screenshot ---------- */
/** Statistik mentah satu entri terenkripsi: hex dump + entropi + index of coincidence. */
export async function forensicSample(buffer, entryName) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const u8 = new Uint8Array(buffer);
  const { entries } = await parseXp3Index(buffer);
  const entry = entries.find((e) => e.name === entryName);
  if (!entry) throw new Error("Entri tidak ditemukan.");
  const seg = entry.segments[0];
  const raw = seg ? u8.subarray(seg.offset, seg.offset + Math.min(seg.packedSize, 1024)) : new Uint8Array(0);
  const hex = Array.from(raw.subarray(0, 48)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const freq = new Array(256).fill(0);
  for (const b of raw) freq[b]++;
  let ent = 0;
  for (let i = 0; i < 256; i++) if (freq[i]) { const p = freq[i] / raw.length; ent -= p * Math.log2(p); }
  let icSum = 0;
  for (let i = 0; i < 256; i++) icSum += freq[i] * (freq[i] - 1);
  const ic = raw.length > 1 ? icSum / (raw.length * (raw.length - 1)) : 0;
  let verdict;
  if (raw.length < 32) verdict = "sampel terlalu kecil untuk dianalisis";
  else if (seg && seg.compressed) verdict = "data terkompresi — pola cipher tersamarkan kompresi";
  else if (ic > 0.055) verdict = "pola berulang terdeteksi (dugaan XOR kunci pendek)";
  else if (ent < 6.5) verdict = "entropi rendah (terstruktur — mungkin bukan cipher kuat)";
  else verdict = "acak (cipher kuat / kunci panjang / kunci per-file)";
  return {
    packedSize: seg ? seg.packedSize : 0,
    unpackedSize: seg ? seg.unpackedSize : 0,
    compressed: !!(seg && seg.compressed),
    segCount: entry.segments.length,
    hashHex: entry.hash !== null && entry.hash !== undefined
      ? "0x" + (entry.hash >>> 0).toString(16).padStart(8, "0") : "-",
    hex, entropy: ent.toFixed(2), ic: ic.toFixed(4), verdict,
  };
}

/* ---------- Kunci dari file .sig pendamping ---------- */
/**
 * Coba kunci dari file .sig (212 byte): keystream langsung + jendela 16/32 byte
 * sebagai kunci berulang. Murah, spekulatif — lolos bila .sig memuat kunci.
 */
export async function crackSigKeys(buffer, entryName, sigBytes, onProgress) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const { entries } = await parseXp3Index(buffer);
  const entry = entries.find((e) => e.name === entryName && e.encrypted);
  if (!entry) throw new Error("Entri tidak ditemukan / tidak terenkripsi.");
  const sample = sampleRaw(buffer, entry, 4 * 1024 * 1024);
  if (!sample || !sample.full) throw new Error("Sampel tidak bisa dibaca.");
  const sig = sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes);
  const results = [];
  const seen = new Set();
  const tryKey = async (kb, label) => {
    if (!kb || kb.length === 0) return;
    const id = kb.length + ":" + Array.from(kb.slice(0, 32)).join(",");
    if (seen.has(id)) return;
    seen.add(id);
    const r = await tryCandidate(sample, (raw) => repeatKey(raw, kb));
    if (r) results.push({ scheme: "sigkey", schemeName: label, key: Array.from(kb), score: r.score, preview: r.preview, encoding: r.encoding, kagMode: r.kagMode, extra: null });
  };
  await tryKey(sig.slice(0, Math.min(sig.length, sample.raw.length)), "keystream .sig langsung");
  const offs = [...new Set([0, 16, 32, Math.max(0, sig.length - 32), Math.max(0, sig.length - 16)])];
  let n = 0;
  for (const len of [16, 32]) {
    for (const off of offs) {
      if (off + len <= sig.length) await tryKey(sig.slice(off, off + len), `kunci .sig[${off}..${off + len}]`);
      n++;
      if (onProgress) onProgress(n / 10);
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3);
}

/* ---------- Kunci dari file .exe game ----------
 * Enkripsi XP3 itu kunci per game, dan kunci itu hampir selalu TERTANAM di
 * dalam .exe game sebagai string password. Itu juga cara GARbro membangun
 * database kuncinya: mengekstrak string dari exe tiap game. Semua brute-force
 * lab sebelumnya buta tanpa sumber kunci — jalur ini yang belum pernah dicoba.
 * Alur: user drop .exe -> ekstrak string kandidat (ASCII & UTF-16LE) ->
 * tiap string dicoba sebagai kunci XOR berulang (varian byte ASCII/UTF-8 dan
 * UTF-16LE) pada sampel .ks -> skor heuristik teks seperti biasa.
 * Tetap 100% di browser, tanpa install apa pun. */
const isAsciiPrint = (b) => b >= 0x20 && b <= 0x7e;

/** Nilai kemiripan-password sebuah string (untuk pengurutan kandidat). */
function rankExeString(s) {
  let sc = 0;
  if (!s.includes(" ")) sc += 2;
  if (s.length >= 6 && s.length <= 32) sc += 2;
  else if (s.length > 32) sc -= 2;
  if (/[0-9]/.test(s)) sc += 1;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) sc += 1;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(s)) sc += 1;
  if (/^[0-9a-fA-F]{32,}$/.test(s)) sc += 1; // hash hex bisa jadi kunci
  if (/^(this |copyright|microsoft|windows|version|program |error|failed|success|warning|please|press)/i.test(s)) sc -= 4;
  if (/\.(dll|exe|ocx|sys|mui|cab)$/i.test(s)) sc -= 4;
  if (/^(https?|ftp|C:\\|\\\\)/i.test(s)) sc -= 4;
  return sc;
}

/**
 * Ekstrak string kandidat kunci dari bytes .exe (ASCII & UTF-16LE).
 * @returns {string[]} kandidat unik, terurut (paling mirip password dulu).
 */
export function extractExeStrings(u8, opts = {}) {
  if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
  const minLen = opts.minLen || 4, maxLen = opts.maxLen || 64, cap = opts.cap || 3000;
  const seen = new Set();
  const out = [];
  const push = (s) => {
    if (s.length < minLen || s.length > maxLen) return;
    if (!/[!-~]/.test(s)) return; // harus ada minimal 1 char non-spasi
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const fromCodes = (arr) => String.fromCharCode.apply(null, arr);
  // --- ASCII: run byte printable ---
  let run = [];
  const flushA = () => {
    if (run.length >= minLen) {
      push(fromCodes(run.slice(0, maxLen)));
      if (run.length > maxLen) push(fromCodes(run.slice(-maxLen)));
    }
    run = [];
  };
  for (let i = 0; i <= u8.length; i++) {
    const b = i < u8.length ? u8[i] : 0;
    if (isAsciiPrint(b)) { if (run.length < maxLen + 16) run.push(b); }
    else flushA();
  }
  // --- UTF-16LE: pasangan (printable, 0x00), toleran misalignment ---
  run = [];
  let runStart = 0;
  const flushW = () => {
    if (run.length >= minLen) {
      push(fromCodes(run.slice(0, maxLen)));
      // Kasus umum di .exe: string ASCII "...XYZ\x00" tepat sebelum string
      // UTF-16LE — char terakhir ASCII (X) + terminatornya (\x00) ikut
      // tersedot sebagai pasangan wide pertama ("sWidePass42"). Bila byte
      // sebelum run terlihat seperti ASCII, tawarkan juga varian tanpa
      // char pertama.
      if (run.length > minLen && runStart >= 1 && isAsciiPrint(u8[runStart - 1])) {
        push(fromCodes(run.slice(1, maxLen + 1)));
      }
    }
    run = [];
  };
  let i = 0;
  while (i + 1 < u8.length) {
    const lo = u8[i], hi = u8[i + 1];
    if (hi === 0 && isAsciiPrint(lo)) {
      if (run.length === 0) runStart = i;
      if (run.length < maxLen) run.push(lo);
      i += 2;
    } else { flushW(); i += 1; }
  }
  flushW();
  out.sort((a, b) => (rankExeString(b) - rankExeString(a)) || (a.length - b.length));
  return out.slice(0, cap);
}

function utf16leKeyBytes(s) {
  const out = new Uint8Array(s.length * 2);
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    out[k * 2] = c & 0xff;
    out[k * 2 + 1] = (c >>> 8) & 0xff;
  }
  return out;
}

/**
 * Coba tiap string .exe sebagai kunci XOR berulang pada satu entri sampel.
 * @param {object} opts.extraCandidates string tambahan (mis. nama file .exe)
 * @returns {Promise<{candidates:number, results:Array}>}
 */
export async function crackExeKeys(buffer, entryName, exeBytes, opts = {}, onProgress) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const { entries } = await parseXp3Index(buffer);
  const entry = entries.find((e) => e.name === entryName && e.encrypted);
  if (!entry) throw new Error(`Entri "${entryName}" tidak ditemukan / tidak terenkripsi.`);
  // Sampel kecil saja (256 KB) agar ribuan kandidat tetap cepat.
  const sample = sampleRaw(buffer, entry, 256 * 1024);
  if (!sample || !sample.full) throw new Error(`Sampel "${entryName}" tidak bisa dibaca (batas 256 KB untuk pindai exe).`);
  const u8 = exeBytes instanceof Uint8Array ? exeBytes : new Uint8Array(exeBytes);
  const strings = extractExeStrings(u8, opts);
  const extra = (opts.extraCandidates || []).filter((s) => typeof s === "string" && s.trim().length >= 2);
  const all = [...new Set([...extra.map((s) => s.trim()), ...strings])];
  const results = [];
  const seenKey = new Set();
  let done = 0, stopped = false;
  for (const s of all) {
    const variants = [
      { kb: new TextEncoder().encode(s), tag: "ASCII" },
      { kb: utf16leKeyBytes(s), tag: "UTF-16LE" },
    ];
    for (const v of variants) {
      const id = v.kb.length + ":" + Array.from(v.kb.slice(0, 24)).join(",");
      if (seenKey.has(id)) continue;
      seenKey.add(id);
      const r = await tryCandidate(sample, (raw) => repeatKey(raw, v.kb));
      if (r) {
        const shown = s.length > 40 ? s.slice(0, 40) + "…" : s;
        results.push({
          scheme: "exekey", schemeName: `Kunci dari .exe (${v.tag}): "${shown}"`,
          key: Array.from(v.kb), keyString: s, score: r.score, preview: r.preview,
          encoding: r.encoding, kagMode: r.kagMode, extra: null,
        });
        if (r.score >= 0.95) { stopped = true; break; }
      }
    }
    if (stopped) break;
    done++;
    if (onProgress && done % 50 === 0) onProgress(done / all.length);
  }
  if (onProgress) onProgress(1);
  results.sort((a, b) => b.score - a.score);
  return { candidates: all.length, results: results.slice(0, 3) };
}

/* ---------- KAG script scrambling (FE FE mode FF FE) ----------
 * Banyak game Kirikiri menyimpan .ks/.tjs "scramble" (BUKAN XOR): header
 * FE FE <mode> FF FE + isi UTF-16LE. Mode 0/1 involusi (self-inverse),
 * mode 2 = deflate. Sumber: arcusmaximus/KirikiriTools (KirikiriDescrambler).
 * Ini lapisan BERBEDA dari enkripsi XP3 — bisa berdiri sendiri atau
 * dikombinasi dengan XOR. */
export function kagScrambleMode(u8) {
  if (u8 && u8.length >= 5 && u8[0] === 0xfe && u8[1] === 0xfe && u8[3] === 0xff && u8[4] === 0xfe) {
    const m = u8[2];
    return m <= 2 ? m : -1;
  }
  return -1;
}

function kagDescrambleSync(u8) {
  const mode = kagScrambleMode(u8);
  if (mode < 0) throw new Error("Bukan KAG-scramble.");
  const data = u8.subarray(5);
  if (mode === 0) {
    const out = new Uint8Array(data.length);
    out.set(data);
    for (let i = 0; i + 1 < out.length; i += 2) {
      const lo = out[i], hi = out[i + 1];
      if (hi === 0 && lo < 0x20) continue;
      out[i + 1] = hi ^ (lo & 0xfe);
      out[i] = lo ^ 1;
    }
    return out;
  }
  if (mode === 1) {
    const out = new Uint8Array(data.length);
    for (let i = 0; i + 1 < data.length; i += 2) {
      const c = data[i] | (data[i + 1] << 8);
      const s = (((c & 0xaaaa) >>> 1) | ((c & 0x5555) << 1)) & 0xffff;
      out[i] = s & 0xff;
      out[i + 1] = (s >>> 8) & 0xff;
    }
    if (data.length % 2) out[data.length - 1] = data[data.length - 1];
    return out;
  }
  throw new Error("Mode 2 butuh inflate (async).");
}

/** Descramble KAG → UTF-16LE bytes DENGAN BOM FF FE (agar decodeBuffer mengenalinya). */
export async function descrambleKag(u8) {
  const mode = kagScrambleMode(u8);
  if (mode < 0) throw new Error("Bukan KAG-scramble.");
  let raw;
  if (mode === 2) {
    const data = u8.subarray(5);
    if (data.length < 18) throw new Error("Mode 2 terlalu pendek.");
    // 8 byte compLen + 8 byte uncompLen + 2 byte zlib header + raw deflate
    raw = await defaultInflate(data.subarray(18));
  } else {
    raw = kagDescrambleSync(u8);
  }
  const out = new Uint8Array(raw.length + 2);
  out[0] = 0xff; out[1] = 0xfe;
  out.set(raw, 2);
  return out;
}

/** Parse hex "11 22 33" / "112233" menjadi array byte. */
export function parseHexKey(s) {
  const clean = String(s || "").replace(/[^0-9a-fA-F]/g, "");
  if (!clean || clean.length % 2 !== 0 || clean.length > 512) throw new Error("Format hex salah (contoh: 11 22 33 atau 112233).");
  const out = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  return out;
}

/** Nama kunci dalam format hex untuk ditampilkan, mis. 0xAB. */
export function keyHex(key) {
  return "0x" + key.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Riddle Joker (Yuzusoft) — skenario terkompilasi .scn.
 * Ditemukan 2026-10-17 via bedah forensik + source publik GARbro:
 * tiap file .scn di-XOR 1 byte dengan kunci per-file yang diturunkan dari
 * magic plaintext "PSB\0" (kunci = byte0 ^ 0x50). Terverifikasi pada 74/78
 * file scn.xp3 Riddle Joker.
 * Update v1.63 (2026-10-17): 4 file varian memakai kunci 0x01 —
 *   110 & 206 beneran bermagic "WSB\0"; 203 & 505 "PSB\0" dengan 1 byte
 *   magik anomali (validasi struktur header sebagai fallback). Kini 78/78.
 * Hook dekripsi: (entryName, segIdx, raw) => bytes terdekripsi.
 */

/** Validasi struktur header PSB (tanpa cek magic) untuk fallback kunci 0x01. */
function validateRiddleJokerHeader(first44, fullLen) {
  if (!first44 || first44.length < 44 || fullLen < 44) return false;
  const dv = new DataView(first44.buffer, first44.byteOffset, first44.byteLength);
  if (dv.getUint16(4, true) !== 3) return false; // version
  if (dv.getUint32(8, true) !== 44) return false; // header_length
  const offStr = dv.getUint32(16, true);
  const offStrData = dv.getUint32(20, true);
  const offEntries = dv.getUint32(36, true);
  return offStr > 0 && offStr < fullLen &&
         offStrData > offStr && offStrData < fullLen &&
         offEntries > 0 && offEntries < fullLen;
}

export function makeRiddleJokerScnDecryptor() {
  const keyByName = new Map();
  return (entryName, segIdx, raw) => {
    if (!raw || raw.length < 8) return raw;
    let key = keyByName.get(entryName);
    if (key === undefined) {
      key = null;
      // 1. PSB: kunci = byte0 ^ 0x50 ('P' dari "PSB\0")
      let k = raw[0] ^ 0x50;
      if ((raw[1] ^ k) === 0x53 && (raw[2] ^ k) === 0x42 && (raw[3] ^ k) === 0x00) {
        key = k;
      } else {
        // 2. WSB: kunci = byte0 ^ 0x57 ('W' dari "WSB\0")
        k = raw[0] ^ 0x57;
        if ((raw[1] ^ k) === 0x53 && (raw[2] ^ k) === 0x42 && (raw[3] ^ k) === 0x00) {
          key = k;
        } else if (raw.length >= 44) {
          // 3. fallback kunci 0x01 + validasi struktur header PSB
          //    (untuk 203 & 505 yang 1 byte magiknya anomali)
          const head = new Uint8Array(44);
          for (let i = 0; i < 44; i++) head[i] = raw[i] ^ 0x01;
          if (validateRiddleJokerHeader(head, raw.length)) key = 0x01;
        }
      }
      if (key === null) return raw; // bukan pola Riddle Joker — jangan rusak data
      keyByName.set(entryName, key);
    }
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key;
    return out;
  };
}

/**
 * Deteksi arsip Riddle Joker: hitung file .scn terenkripsi yang lolos
 * verifikasi magic "PSB\0"/"WSB\0" setelah XOR 1-byte, plus fallback
 * kunci 0x01 dengan validasi struktur header. Perlu baca data segmen.
 * @returns {Promise<{count:number, verified:number}>}
 */
export async function detectRiddleJokerScn(buffer, inflate) {
  if (!(buffer instanceof ArrayBuffer)) {
    buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const u8 = new Uint8Array(buffer);
  const { entries } = await parseXp3Index(buffer);
  const scn = entries.filter((e) => e.encrypted && e.name.toLowerCase().endsWith(".scn"));
  let verified = 0;
  for (const e of scn.slice(0, 10)) {
    const seg = e.segments[0];
    if (!seg || seg.packedSize < 8) continue;
    const raw = u8.slice(seg.offset, seg.offset + Math.min(seg.packedSize, 44));
    // 1. PSB
    let key = raw[0] ^ 0x50;
    if ((raw[1] ^ key) === 0x53 && (raw[2] ^ key) === 0x42 && (raw[3] ^ key) === 0x00) {
      verified++;
      continue;
    }
    // 2. WSB
    key = raw[0] ^ 0x57;
    if ((raw[1] ^ key) === 0x53 && (raw[2] ^ key) === 0x42 && (raw[3] ^ key) === 0x00) {
      verified++;
      continue;
    }
    // 3. fallback kunci 0x01 + validasi struktur header
    if (raw.length >= 44) {
      const head = new Uint8Array(44);
      for (let i = 0; i < 44; i++) head[i] = raw[i] ^ 0x01;
      if (validateRiddleJokerHeader(head, seg.packedSize)) verified++;
    }
  }
  return { count: scn.length, verified };
}

/* ---------- Riddle Joker lapis-2 + ekstrak dialog (v1.64) ----------
 * Setelah lapis-1 (XOR arsip per-file) dibuka, 77/78 file .scn punya lapisan
 * XOR 1-byte KEDUA pada region string [u32@20, u32@24) dengan kunci UNIK
 * per file. Kunci dipulihkan via known-plaintext: 4 byte @ u32@36
 * ("offEntries") setelah XOR harus = 21 0d 05 0d. Kunci 0x00 = tidak ada
 * lapis-2 (hanya file 110.あやせ（エピローグ）). Ditemukan 2026-10-17 via
 * bedah forensik; derivasi terverifikasi 78/78 file.
 * PENTING: kunci TIDAK di-hardcode — diderivasi via uji 256 kunci di browser. */

/**
 * Turunkan kunci lapis-2 dari buffer hasil dekripsi lapis-1.
 * @returns {number|null} kunci 1-255, atau null jika tidak ada lapis-2
 */
export function deriveRiddleJokerLayer2Key(decrypted) {
  if (!decrypted || decrypted.length < 44) return null;
  const dv = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
  const offEntries = dv.getUint32(36, true);
  if (!(offEntries + 4 <= decrypted.length)) return null;
  for (let k = 0; k < 256; k++) {
    if ((decrypted[offEntries] ^ k) === 0x21 &&
        (decrypted[offEntries + 1] ^ k) === 0x0d &&
        (decrypted[offEntries + 2] ^ k) === 0x05 &&
        (decrypted[offEntries + 3] ^ k) === 0x0d) {
      return k === 0 ? null : k; // 0x00 = memang tidak ada lapis-2
    }
  }
  return null;
}

/**
 * Terapkan dekripsi lapis-2 (XOR region string) ke buffer hasil lapis-1.
 * @returns {Uint8Array} buffer baru jika ada lapis-2, buffer asli jika tidak
 */
export function applyRiddleJokerLayer2(decrypted) {
  const key = deriveRiddleJokerLayer2Key(decrypted);
  if (key === null) return decrypted;
  const dv = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
  const s0 = dv.getUint32(20, true);
  const s1 = dv.getUint32(24, true);
  if (!(s0 < s1 && s1 <= decrypted.length)) return decrypted;
  const out = new Uint8Array(decrypted);
  for (let i = s0; i < s1; i++) out[i] ^= key;
  return out;
}

/** Buang markup ruby [　...　] (kurung siku berisi spasi fullwidth U+3000). */
export function cleanRiddleJokerRuby(s) {
  return s.replace(/\[[^\[\]]*　[^\[\]]*\]/g, "");
}

/**
 * Ekstrak baris dialog dari file .scn yang sudah di-dekripsi lapis-1+2.
 * String adalah UTF-8 NUL-terminated di region [u32@20, u32@24).
 * Filter: hanya baris diawali 「 yang mengandung kana (fokus Jepang;
 * baris murni Hanzi tanpa kana kemungkinan teks Mandarin campuran).
 * @returns {string[]} baris dialog bersih (tanpa ruby)
 */
export function extractRiddleJokerDialogue(decrypted) {
  if (!decrypted || decrypted.length < 44) return [];
  const dv = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
  const s0 = dv.getUint32(20, true);
  const s1 = dv.getUint32(24, true);
  if (!(s0 < s1 && s1 <= decrypted.length)) return [];
  const region = decrypted.subarray(s0, s1);
  const decoder = new TextDecoder("utf-8");
  const out = [];
  let start = 0;
  for (let i = 0; i <= region.length; i++) {
    if (i === region.length || region[i] === 0) {
      if (i > start) {
        let s = null;
        try {
          s = decoder.decode(region.subarray(start, i));
        } catch { /* byte tidak valid — lewati */ }
        if (s && s.startsWith("「") && /[\u3040-\u30ff]/.test(s)) {
          out.push(cleanRiddleJokerRuby(s));
        }
      }
      start = i + 1;
    }
  }
  return out;
}
