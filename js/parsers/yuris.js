/* Parser script YU-RIS (.ybn, magic 'YSTB')
 *
 * Mendukung format V300 (engine v300-v500, layout cmds/args/expr/lnos).
 * Setiap section di-XOR dengan kunci tetap (0xD36FAC96 untuk v290+).
 *
 * Cakupan v1: ekstraksi + rebuild string WORD (dialog/narasi) beserta
 * kode kontrolnya (ganti baris, page break, tunggu klik). Command lain
 * (EVAL dsb.) tidak disentuh — byte-nya disalin verbatim saat rebuild.
 *
 * Referensi format: yuris_decompiler (MIT) & VNTextPatch (MIT).
 */

export const KEY_200 = 0x07b4024a; // v200-v289
export const KEY_300 = 0xd36fac96; // v290-v500

const YSTB_MAGIC = 0x42545359; // 'YSTB' little-endian
const YSCM_MAGIC = 0x4d435359; // 'YSCM' little-endian

/** XOR per grup 4 byte (key dalam urutan big-endian), in-place. */
export function xorTrans(u8, key) {
  const k = [
    (key >>> 24) & 0xff,
    (key >>> 16) & 0xff,
    (key >>> 8) & 0xff,
    key & 0xff,
  ];
  const aligned = u8.length & ~3;
  for (let i = 0; i < aligned; i += 4) {
    u8[i] ^= k[0];
    u8[i + 1] ^= k[1];
    u8[i + 2] ^= k[2];
    u8[i + 3] ^= k[3];
  }
  for (let j = 0; j < (u8.length & 3); j++) u8[aligned + j] ^= k[j];
  return u8;
}

const sjisDec = new TextDecoder("shift-jis");

function readSz(u8, off) {
  let end = off;
  while (end < u8.length && u8[end] !== 0) end++;
  return { text: sjisDec.decode(u8.subarray(off, end)), next: end + 1 };
}

/** Parse ysc.ybn -> { version, commands: [nama], wordCode } */
export function parseYsc(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 16) throw new Error("File ysc.ybn terlalu kecil / rusak.");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  const magic = dv.getUint32(off, true); off += 4;
  if (magic !== YSCM_MAGIC) throw new Error("Bukan ysc.ybn (magic YSCM tidak cocok).");
  const ver = dv.getUint32(off, true); off += 4;
  const ncmd = dv.getUint32(off, true); off += 4;
  off += 4; // padding
  const commands = [];
  for (let i = 0; i < ncmd; i++) {
    const r = readSz(u8, off); off = r.next;
    const narg = u8[off]; off += 1;
    for (let a = 0; a < narg; a++) {
      const ra = readSz(u8, off); off = ra.next;
      off += 2; // typ, chk
    }
    commands.push(r.text);
  }
  const wordCode = commands.indexOf("WORD");
  if (wordCode < 0) throw new Error("Command WORD tidak ditemukan di ysc.ybn.");
  const special = {
    wordCode,
    ifCode: commands.indexOf("IF"),
    elseCode: commands.indexOf("ELSE"),
    loopCode: commands.indexOf("LOOP"),
  };
  return { version: ver, commands, wordCode, special };
}

/* --- kode kontrol YU-RIS (byte 0xEF xx) <-> representasi editor --- */
const CTRL_OUT = { 0xf0: "\n", 0xf2: "\x01", 0xf3: "\x02", 0xf5: "\x03" };

/** Ubah raw bytes WORD -> string editor. \x01=page break, \x02=tunggu klik. */
export function wordToText(raw) {
  const parts = [];
  let buf = [];
  const flush = () => {
    if (buf.length) { parts.push(sjisDec.decode(new Uint8Array(buf))); buf = []; }
  };
  let i = 0;
  while (i < raw.length) {
    const b = raw[i];
    if (b === 0xef && i + 1 < raw.length && CTRL_OUT[raw[i + 1]] !== undefined) {
      flush();
      parts.push(CTRL_OUT[raw[i + 1]]);
      i += 2;
      continue;
    }
    buf.push(b);
    // lewati trail byte SJIS agar 0xEF di dalam kanji tidak disalahartikan
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      if (i + 1 < raw.length) { buf.push(raw[i + 1]); i++; }
    }
    i++;
  }
  flush();
  return parts.join("");
}

/**
 * Ubah string editor -> raw bytes WORD.
 * encodeSjis: (str) -> Uint8Array. Di browser memakai Encoding.convert (CDN).
 * Konvensi: \n = ganti baris, \p = page break, \c = tunggu klik.
 */
export function textToWord(text, encodeSjis) {
  const tmp = text
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/\\p/g, "\x01").replace(/\\c/g, "\x02").replace(/\\u/g, "\x03");
  const enc = encodeSjis(tmp);
  const out = [];
  for (const b of enc) {
    if (b === 0x0a) out.push(0xef, 0xf0);
    else if (b === 0x01) out.push(0xef, 0xf2);
    else if (b === 0x02) out.push(0xef, 0xf3);
    else if (b === 0x03) out.push(0xef, 0xf5);
    else out.push(b);
  }
  return new Uint8Array(out);
}

/** Pisah "Nama「teks」" / "Nama（teks）" -> { speaker, text, bracket }. */
export function splitSpeaker(s) {
  let m = s.match(/^(.*?)[「『](.*)[」』]$/s);
  if (m) return { speaker: m[1], text: m[2], bracket: "kagikakko" };
  m = s.match(/^(.*?)（(.*)）$/s);
  if (m) return { speaker: m[1], text: m[2], bracket: "marukakko" };
  return { speaker: "", text: s, bracket: "none" };
}

/** Gabung kembali speaker + isi sesuai gaya kurung aslinya. */
export function joinSpeaker(speaker, body, bracket) {
  if (!speaker) return body;
  if (bracket === "marukakko") return `${speaker}（${body}）`;
  return `${speaker}「${body}」`;
}

/**
 * Parse satu file yst*.ybn (V300).
 * @returns { version, wordCode, cmds, words, _bin }
 * words: [{ cmdIdx, argIdx, offset, size, raw, text, speaker }]
 */
export function parseYstb(bytes, special) {
  const wordCode = typeof special === "number" ? special : special.wordCode;
  const spec = typeof special === "number" ? { wordCode } : special;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 32) throw new Error("File terlalu kecil untuk script YSTB.");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  const magic = dv.getUint32(off, true); off += 4;
  if (magic !== YSTB_MAGIC) throw new Error("Bukan script YSTB (magic tidak cocok).");
  const ver = dv.getUint32(off, true); off += 4;
  if (ver < 300 || ver >= 501)
    throw new Error(`Versi YSTB ${ver} belum didukung (baru V300: v300-v500).`);
  const ncmd = dv.getUint32(off, true); off += 4;
  const lcmd = dv.getUint32(off, true); off += 4;
  const larg = dv.getUint32(off, true); off += 4;
  const lexp = dv.getUint32(off, true); off += 4;
  const llno = dv.getUint32(off, true); off += 4;
  off += 4; // padding
  if (lcmd !== ncmd * 4 || llno !== ncmd * 4 || larg % 12 !== 0)
    throw new Error("Header YSTB tidak konsisten.");

  const key = KEY_300;
  const cmdsEnc = u8.slice(off, off + lcmd); off += lcmd;
  const argsEnc = u8.slice(off, off + larg); off += larg;
  const exprEnc = u8.slice(off, off + lexp); off += lexp;
  const lnosEnc = u8.slice(off, off + llno); off += llno;

  const cmdsData = xorTrans(cmdsEnc.slice(), key);
  const argsData = xorTrans(argsEnc.slice(), key);
  const exprData = xorTrans(exprEnc.slice(), key);
  const cdv = new DataView(cmdsData.buffer);
  const adv = new DataView(argsData.buffer);

  const cmds = [];
  const words = [];
  let argPos = 0;
  for (let c = 0; c < ncmd; c++) {
    const code = cmdsData[c * 4];
    const narg = cmdsData[c * 4 + 1];
    if (narg > 64)
      throw new Error("Struktur script tidak wajar — kemungkinan varian YSTB lain atau kunci enkripsi berbeda dari game ini.");
    const args = [];
    for (let a = 0; a < narg; a++) {
      const p = argPos * 12;
      if (p + 12 > argsData.length)
        throw new Error("Data argumen script terpotong/tidak konsisten — kemungkinan file rusak atau varian YSTB lain.");
      const kwId = adv.getUint16(p, true);
      const type = argsData[p + 2];
      const assign = argsData[p + 3];
      const size = adv.getUint32(p + 4, true);
      const offset = adv.getUint32(p + 8, true);
      args.push({ kwId, type, assign, size, offset, argPos });
      if (code === wordCode && type === 0) {
        const raw = exprData.slice(offset, offset + size);
        const text = wordToText(raw);
        const { speaker, text: body, bracket } = splitSpeaker(text);
        words.push({
          key: `w:${c}:${argPos}`,
          cmdIdx: c, argIdx: argPos, argPos, offset, size,
          raw, text, speaker, body, bracket,
        });
      }
      argPos++;
    }
    cmds.push({ code, narg, args });
  }

  return {
    version: ver, wordCode, special: spec, cmds, words, ncmd,
    _bin: { cmdsEnc, argsEnc, exprEnc, lnosEnc, lcmd, larg, lexp, llno, key },
  };
}

/**
 * Rebuild .ybn dari hasil parse + terjemahan.
 *
 * expr_data dibangun ulang dengan teknik splice: hanya rentang WORD yang
 * diterjemahkan diganti; sisanya (termasuk gap & region yang dipakai
 * bersama) dipertahankan. Semua offset arg dihitung ulang lewat transformasi
 * koordinat, termasuk branch target IF/ELSE/LOOP.
 *
 * @param parsed hasil parseYstb
 * @param translations Map key -> string editor LENGKAP (speaker + isi)
 * @param encodeSjis (str) -> Uint8Array
 * @returns Uint8Array file .ybn baru
 */
export function rebuildYstb(parsed, translations, encodeSjis) {
  const { cmds, words, _bin, special } = parsed;
  const { key } = _bin;
  const origExpr = xorTrans(_bin.exprEnc.slice(), key);

  // 1. Kumpulkan penggantian WORD yang diterjemahkan
  const reps = [];
  for (const w of words) {
    const t = translations.get(w.key);
    if (t !== undefined && t !== w.text) {
      reps.push({ offset: w.offset, size: w.size, bytes: textToWord(t, encodeSjis), key: w.key });
    }
  }
  reps.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < reps.length; i++) {
    if (reps[i].offset < reps[i - 1].offset + reps[i - 1].size)
      throw new Error("Rentang string WORD tumpang tindih — rebuild dibatalkan.");
  }

  // 2. Splice -> expr_data baru
  const newExpr = [];
  let srcPos = 0;
  const deltas = [];
  let cumDelta = 0;
  for (const r of reps) {
    for (let i = srcPos; i < r.offset; i++) newExpr.push(origExpr[i]);
    for (const b of r.bytes) newExpr.push(b);
    cumDelta += r.bytes.length - r.size;
    deltas.push({ end: r.offset + r.size, cumDelta });
    srcPos = r.offset + r.size;
  }
  for (let i = srcPos; i < origExpr.length; i++) newExpr.push(origExpr[i]);
  const newPos = (p) => {
    let d = 0;
    for (const e of deltas) {
      if (e.end <= p) d = e.cumDelta;
      else break;
    }
    return p + d;
  };

  // 3. Tulis ulang args_data dengan offset/size baru
  const newArgs = new Uint8Array(_bin.larg);
  const ndv = new DataView(newArgs.buffer);
  const repByKey = new Map(reps.map((r) => [r.key, r.bytes]));
  const wordKeyByArgPos = new Map(words.map((w) => [w.argPos, w.key]));
  const argList = [];
  cmds.forEach((cmd, ci) => cmd.args.forEach((a, ai) => argList.push({ cmd, arg: a, ai })));
  for (const { cmd, arg, ai } of argList) {
    const p = arg.argPos * 12;
    ndv.setUint16(p, arg.kwId, true);
    newArgs[p + 2] = arg.type;
    newArgs[p + 3] = arg.assign;
    const wkey = wordKeyByArgPos.get(arg.argPos);
    const repBytes = wkey ? repByKey.get(wkey) : undefined;
    const isBranch =
      (cmd.code === special.ifCode || cmd.code === special.elseCode || cmd.code === special.loopCode) &&
      ai >= 1;
    let newOff, newSize;
    if (repBytes) {
      newOff = newPos(arg.offset);
      newSize = repBytes.length;
    } else if (isBranch) {
      // branch target: size bukan ukuran data — jangan diubah, offset ikut geser
      newOff = newPos(arg.offset);
      newSize = arg.size;
    } else {
      newOff = newPos(arg.offset);
      newSize = newPos(arg.offset + arg.size) - newOff;
    }
    ndv.setUint32(p + 4, newSize, true);
    ndv.setUint32(p + 8, newOff, true);
  }

  const newExprU8 = new Uint8Array(newExpr);
  const header = new Uint8Array(32);
  const hdv = new DataView(header.buffer);
  hdv.setUint32(0, YSTB_MAGIC, true);
  hdv.setUint32(4, parsed.version, true);
  hdv.setUint32(8, parsed.ncmd, true);
  hdv.setUint32(12, _bin.lcmd, true);
  hdv.setUint32(16, _bin.larg, true);
  hdv.setUint32(20, newExprU8.length, true);
  hdv.setUint32(24, _bin.llno, true);
  hdv.setUint32(28, 0, true);

  const out = new Uint8Array(32 + _bin.lcmd + _bin.larg + newExprU8.length + _bin.llno);
  out.set(header, 0);
  out.set(_bin.cmdsEnc, 32);
  out.set(xorTrans(newArgs, key), 32 + _bin.lcmd);
  out.set(xorTrans(newExprU8, key), 32 + _bin.lcmd + _bin.larg);
  out.set(_bin.lnosEnc, 32 + _bin.lcmd + _bin.larg + newExprU8.length);
  return out;
}

/** Cari kode WORD dari ysc.ybn lalu parse script. */
export function parseYbnScript(ybnBytes, yscBytes) {
  const { wordCode, special } = parseYsc(yscBytes);
  return parseYstb(ybnBytes, special);
}

export const YURIS_SCRIPT = {
  id: "yuris-script",
  name: "YU-RIS (script .ybn)",
  exts: [".ybn"],
  status: "supported",
  kind: "script",
  description: "Script YSTB V300: dialog WORD + kode kontrol.",
};
