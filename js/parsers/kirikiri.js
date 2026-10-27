/* Parser Kirikiri KAG (.ks / .scn / .txt)
 * Di KAG, baris teks biasa = teks pesan/dialog. Yang dilewati:
 * - baris kosong
 * - komentar (diawali ;)
 * - label (diawali *)
 * - macro (diawali @)
 * - baris yang hanya berisi tag [ ... ]
 * Tag inline ([r], [p], [ruby ...], dsb.) dipertahankan di dalam teks;
 * penerjemah wajib menjaga tag tersebut.
 */

const TAG_ONLY_RE = /^\[[^\]]*\]\s*$/;

export function parseKirikiri(text) {
  const segments = [];
  const warnings = [];
  const lines = text.split("\n");
  let offset = 0;
  let tagLines = 0;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineNo = idx + 1;
    const t = line.trim();
    const start = offset;
    const end = offset + rawLine.replace(/\r$/, "").length;

    if (!t) {
      // kosong -> lewati
    } else if (t.startsWith(";") || t.startsWith("*") || t.startsWith("@")) {
      // komentar / label / macro -> lewati
    } else if (TAG_ONLY_RE.test(t)) {
      tagLines++;
    } else {
      segments.push({
        key: `kag:L${lineNo}`,
        line: lineNo,
        speaker: "",
        speakerVar: "",
        kind: "message",
        source: line,
        translation: "",
        start,
        end,
      });
    }
    offset += rawLine.length + 1;
  });

  if (segments.some((s) => /\[[^\]]+\]/.test(s.source))) {
    warnings.push(
      "Beberapa baris mengandung tag inline KAG ([r], [p], [ruby], ...). " +
        "Jangan hapus atau ubah tag tersebut saat menerjemahkan."
    );
  }
  warnings.push(
    "KAG tidak punya penanda nama pembicara yang baku, jadi kolom pembicara dikosongkan."
  );

  return { segments, warnings };
}

export function applyKirikiri(original, segments) {
  const sorted = [...segments]
    .filter((s) => s.translation !== "" && s.translation != null)
    .sort((a, b) => b.start - a.start);
  let out = original;
  for (const s of sorted) {
    out = out.slice(0, s.start) + s.translation + out.slice(s.end);
  }
  return out;
}

export const KIRIKIRI = {
  id: "kirikiri",
  name: "Kirikiri (KAG)",
  exts: [".ks", ".scn", ".txt"],
  status: "supported",
  description: "Baris teks pesan KAG; tag inline dipertahankan (.ks/.scn).",
  parse: parseKirikiri,
  apply: applyKirikiri,
};
