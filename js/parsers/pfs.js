/* Parser arsip Artemis .pfs (format PF6/PF8).
 * Port dari pfs-rs/pf8 (MIT, https://github.com/sakarie9/pfs-rs).
 * Struktur:
 *   magic "pf6"/"pf8" (3 byte)
 *   index_size u32LE @0x3  (dihitung dari 0x7)
 *   index_count u32LE @0x7
 *   entries @0x0B: [name_len u32][nama Shift-JIS + NUL][00 00 00 00][offset u32][size u32]
 * Kunci PF8: SHA1(bytes[0x7 .. 0x7+index_size]); tiap file di-XOR dengan kunci
 * (kecuali .mp4/.flv). PF6 tidak terenkripsi.
 *
 * API:
 *   const pfs = await openPfs(arrayBuffer);
 *   pfs.entries;            // [{ name, size }]
 *   pfs.getData(i);         // Uint8Array (sudah didekripsi)
 */

const UNENCRYPTED_EXTS = new Set(["mp4", "flv"]);

function u32le(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

async function sha1(u8) {
  const h = await crypto.subtle.digest("SHA-1", u8);
  return new Uint8Array(h);
}

export async function openPfs(buffer) {
  // Salin eksplisit: Buffer.slice() adalah view (bukan salinan) — tanpa ini,
  // dekripsi XOR di getData() akan memutasi buffer asli pemanggil.
  const b = new Uint8Array(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  if (b.length < 11) throw new Error("File terlalu kecil untuk arsip PFS.");
  const magic = String.fromCharCode(b[0], b[1], b[2]);
  if (magic !== "pf6" && magic !== "pf8") {
    throw new Error("Bukan arsip PFS (magic tidak cocok).");
  }
  const encrypted = magic === "pf8";
  const indexSize = u32le(b, 0x3);
  const indexCount = u32le(b, 0x7);
  if (indexCount > 200000) throw new Error("Jumlah entri tidak wajar — file mungkin rusak.");

  const entries = [];
  let p = 0x0b;
  const dec = new TextDecoder("shift-jis");
  for (let i = 0; i < indexCount; i++) {
    if (p + 4 > b.length) throw new Error("Indeks PFS terpotong.");
    const nameLen = u32le(b, p); p += 4;
    if (nameLen > 4096 || p + nameLen + 12 > b.length) throw new Error("Indeks PFS terpotong.");
    const name = dec.decode(b.subarray(p, p + nameLen)).replace(/\0.*$/, "");
    p += nameLen + 4; // + 4 byte nol
    const offPos = p;
    const offset = u32le(b, p); p += 4;
    const sizePos = p;
    const size = u32le(b, p); p += 4;
    if (offset + size > b.length) throw new Error(`Data "${name}" keluar dari batas file.`);
    entries.push({ name, offset, size, offPos, sizePos });
  }

  let key = null;
  if (encrypted) {
    const end = Math.min(0x7 + indexSize, b.length);
    key = await sha1(b.slice(0x7, end));
  }

  function getData(i) {
    const e = entries[i];
    const data = b.slice(e.offset, e.offset + e.size);
    const ext = (e.name.split(".").pop() || "").toLowerCase();
    if (encrypted && key && !UNENCRYPTED_EXTS.has(ext)) {
      for (let j = 0; j < data.length; j++) data[j] ^= key[j % key.length];
    }
    return data;
  }

  return { format: magic, indexSize, entries, getData };
}

/* Bangun ulang .pfs dari buffer asli + penggantian data per nama entri.
 * Strategi aman: region indeks disalin byte-per-byte, hanya field offset &
 * size tiap entri yang di-patch di posisi aslinya (urutan & nama tak berubah),
 * lalu kunci PF8 dihitung ulang dari indeks baru: SHA1(bytes[0x7..0x7+index_size]).
 * replacements: Map nama entri -> Uint8Array (data BARU, belum terenkripsi).
 * Entri yang tidak ada di replacements memakai data asli.
 * return Uint8Array arsip .pfs baru yang siap ditulis kembali ke game.
 */
export async function rebuildPfs(originalBuffer, replacements) {
  const b = originalBuffer instanceof Uint8Array ? originalBuffer : new Uint8Array(originalBuffer);
  const pfs = await openPfs(b);
  const { entries, indexSize, format } = pfs;
  const rep = replacements instanceof Map ? replacements : new Map();

  const newIndex = new Uint8Array(b.subarray(0x7, 0x7 + indexSize)); // salin eksplisit (alasan: lihat openPfs)
  const ndv = new DataView(newIndex.buffer, newIndex.byteOffset, newIndex.byteLength);
  const dataStart = 0x7 + indexSize;

  let off = dataStart;
  const datas = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const r = rep.get(e.name);
    const data = r instanceof Uint8Array ? r : pfs.getData(i);
    ndv.setUint32(e.offPos - 0x7, off >>> 0, true);
    ndv.setUint32(e.sizePos - 0x7, data.length >>> 0, true);
    datas.push({ entry: e, data });
    off += data.length;
  }

  let key = null;
  if (format === "pf8") key = await sha1(newIndex);

  const out = new Uint8Array(dataStart + (off - dataStart));
  out.set(b.subarray(0, 0x7), 0);
  out.set(newIndex, 0x7);
  let wpos = dataStart;
  for (const { entry: e, data } of datas) {
    const ext = (e.name.split(".").pop() || "").toLowerCase();
    if (key && !UNENCRYPTED_EXTS.has(ext)) {
      const enc = new Uint8Array(data); // salin — jangan mutasi data milik pemanggil
      for (let j = 0; j < enc.length; j++) enc[j] ^= key[j % key.length];
      out.set(enc, wpos);
    } else {
      out.set(data, wpos);
    }
    wpos += data.length;
  }
  return out;
}
