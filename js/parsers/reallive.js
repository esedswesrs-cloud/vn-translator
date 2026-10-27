/* Parser RealLive (.txt, mis. Seen.txt)
 * Heuristik berbasis baris:
 * - baris kosong -> lewati
 * - baris diawali # -> perintah engine, lewati
 * - selain itu -> baris teks (sering dibungkus 「」)
 * Seluruh baris dipertahankan apa adanya; terjemahan mengganti isi baris.
 * Catatan: file RealLive umumnya ber-encoding Shift-JIS.
 */

export function parseRealLive(text) {
  const segments = [];
  const warnings = [];
  const lines = text.split("\n");
  let offset = 0;
  let skippedCmd = 0;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineNo = idx + 1;
    const t = line.trim();
    const start = offset;
    const end = offset + line.length;

    if (!t) {
      // kosong
    } else if (t.startsWith("#")) {
      skippedCmd++;
    } else {
      segments.push({
        key: `rl:L${lineNo}`,
        line: lineNo,
        speaker: "",
        speakerVar: "",
        kind: "text",
        source: line,
        translation: "",
        start,
        end,
      });
    }
    offset += rawLine.length + 1;
  });

  warnings.push(
    "Deteksi berbasis heuristik baris: baris perintah (#...) dilewati, " +
      "sisanya dianggap teks. Periksa hasilnya sebelum mengekspor."
  );
  warnings.push(
    "File RealLive umumnya ber-encoding Shift-JIS; hasil ekspor disarankan " +
      "disimpan kembali sebagai Shift-JIS."
  );

  return { segments, warnings };
}

export function applyRealLive(original, segments) {
  const sorted = [...segments]
    .filter((s) => s.translation !== "" && s.translation != null)
    .sort((a, b) => b.start - a.start);
  let out = original;
  for (const s of sorted) {
    out = out.slice(0, s.start) + s.translation + out.slice(s.end);
  }
  return out;
}

export const REALLIVE = {
  id: "reallive",
  name: "RealLive",
  exts: [".txt"],
  status: "supported",
  description: "Heuristik baris teks Seen.txt; perintah # dilewati.",
  parse: parseRealLive,
  apply: applyRealLive,
};
