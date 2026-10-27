/* Parser Naninovel (.nani) — framework visual novel untuk Unity (NaniScript).
 * - ";..."            -> komentar, dilewati
 * - "# Label"         -> label, dilewati
 * - "@perintah ..."   -> perintah, dilewati — kecuali:
 *     @choice "teks"  -> "teks" adalah teks pilihan (ikut diterjemahkan)
 * - "Nama: dialog"    -> dialog (Nama = pembicara)
 * - baris teks biasa  -> narasi
 * Referensi: dokumentasi Naninovel (naninovel.com).
 */

const CHOICE_RE = /@choice\s+"((?:\\.|[^"\\])*)"/i;
const DIALOG_RE = /^([A-Za-z0-9_.\-]+)\s*:\s*(.+)$/;

export function parseNaninovel(text) {
  const lines = text.split("\n");
  const segments = [];
  const warnings = [];
  let n = 0;
  let offset = 0;

  lines.forEach((rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineStart = offset;
    const t = line.trim();

    if (!t || t.startsWith(";") || t.startsWith("#")) { offset += rawLine.length + 1; return; }

    if (t.startsWith("@")) {
      const cm = CHOICE_RE.exec(t);
      if (cm) {
        // Segmen mencakup isi kutip saja (tanda kutip dipertahankan)
        const inner = cm[1];
        const at = line.indexOf(inner, line.indexOf('"'));
        if (at >= 0) {
          segments.push({
            key: `nani:C${n++}`, line: -1, speaker: "", speakerVar: "",
            kind: "choice", source: inner, translation: "",
            start: lineStart + at, end: lineStart + at + inner.length,
          });
        }
      }
      offset += rawLine.length + 1;
      return;
    }

    const dm = DIALOG_RE.exec(t);
    if (dm) {
      const speaker = dm[1];
      const body = dm[2];
      const at = line.indexOf(body, line.indexOf(":") + 1);
      segments.push({
        key: `nani:D${n++}`, line: -1, speaker, speakerVar: "",
        kind: "message", source: body, translation: "",
        start: lineStart + at, end: lineStart + at + body.length,
      });
    } else {
      segments.push({
        key: `nani:N${n++}`, line: -1, speaker: "", speakerVar: "",
        kind: "message", source: line, translation: "",
        start: lineStart, end: lineStart + line.length,
      });
    }
    offset += rawLine.length + 1;
  });

  warnings.push(
    "Teks di @choice \"...\" ikut diterjemahkan; tanda kutip jangan dihapus. " +
    "Perintah @ lain jangan diubah."
  );
  return { segments, warnings };
}

export function applyNaninovel(original, segments) {
  const sorted = [...segments]
    .filter((s) => s.translation !== "" && s.translation != null && s.start >= 0)
    .sort((a, b) => b.start - a.start);
  let out = original;
  for (const s of sorted) {
    out = out.slice(0, s.start) + s.translation + out.slice(s.end);
  }
  return out;
}

export const NANINOVEL = {
  id: "naninovel",
  name: "Naninovel (Unity)",
  exts: [".nani"],
  status: "supported",
  description: "Naninovel .nani — framework visual novel Unity; dialog, narasi, dan @choice.",
  parse: parseNaninovel,
  apply: applyNaninovel,
};
