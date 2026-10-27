/* Parser Artemis Engine — format TXT (teks, mirip KAG).
 * - baris "*..."            -> label, dilewati
 * - baris "[cmd ...]"       -> perintah utuh, dilewati — kecuali:
 *     [name X]              -> X adalah nama pembicara (ikut diterjemahkan)
 *     [sel_text text="..."] -> "..." adalah teks pilihan (ikut diterjemahkan)
 * - komentar // atau ;      -> dibuang
 * - paragraf teks biasa (dipisah baris kosong) -> satu segmen dialog
 * Tag inline [...] di dalam dialog dipertahankan (MT diinstruksikan tidak mengubahnya).
 * Referensi: VNTranslationTools ArtemisTxtScript (MIT).
 */

const CMD_RE = /^\s*\[([^\]\s'"]+)((?:\s+[^\]'"=\s]+(?:\s*=\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\]'"\s]+))?)*)\s*\]\s*$/;
const ATTR_RE = /([^\]'"=\s]+)(?:\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\]'"\s]+))?/g;

function stripComment(line) {
  // Komentar // atau ; — ; hanya di awal baris (ala KAG) agar titik-koma di dialog aman
  return line.replace(/\/\/.*$/, "").replace(/^\s*;.*$/, "");
}

function parseCommand(t) {
  const m = CMD_RE.exec(t);
  if (!m) return null;
  const attrs = [];
  let am;
  ATTR_RE.lastIndex = 0;
  while ((am = ATTR_RE.exec(m[2] || ""))) {
    let val = am[2] ?? null;
    const quoted = val != null && (val.startsWith('"') || val.startsWith("'"));
    if (quoted) val = val.slice(1, -1);
    attrs.push({ name: am[1], value: val, quoted });
  }
  return { cmd: m[1].toLowerCase(), attrs, raw: t };
}

function attrVal(parsed, name) {
  return parsed.attrs.find((a) => a.name.toLowerCase() === name) || null;
}

export function parseArtemis(text) {
  const lines = text.split("\n");
  const segments = [];
  const warnings = [];
  let n = 0;
  let offset = 0;
  let paraStart = -1, paraEnd = -1;

  const flushPara = () => {
    if (paraStart >= 0) {
      const source = text.slice(paraStart, paraEnd);
      if (source.trim()) {
        segments.push({
          key: `artemis:P${n++}`, line: -1, speaker: "", speakerVar: "",
          kind: "message", source, translation: "",
          start: paraStart, end: paraEnd,
        });
      }
      paraStart = -1; paraEnd = -1;
    }
  };

  lines.forEach((rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineStart = offset;
    const t = stripComment(line).trim();

    if (t.startsWith("*")) { flushPara(); offset += rawLine.length + 1; return; }

    const cmd = t.startsWith("[") ? parseCommand(t) : null;
    if (cmd) {
      flushPara();
      if (cmd.cmd === "name" && cmd.attrs.length > 0) {
        // [name X] — nama pembicara adalah atribut pertamanya
        const nm = cmd.attrs[0].name;
        const at = line.indexOf(nm, line.indexOf("["));
        if (at >= 0) {
          segments.push({
            key: `artemis:N${n++}`, line: -1, speaker: "", speakerVar: "",
            kind: "name", source: nm, translation: "",
            start: lineStart + at, end: lineStart + at + nm.length,
          });
        }
      } else if (cmd.cmd === "sel_text") {
        const tv = attrVal(cmd, "text");
        if (tv && tv.value != null) {
          const at = line.indexOf(tv.value, line.indexOf("text"));
          if (at >= 0) {
            segments.push({
              key: `artemis:C${n++}`, line: -1, speaker: "", speakerVar: "",
              kind: "choice", source: tv.value, translation: "",
              start: lineStart + at, end: lineStart + at + tv.value.length,
              quoted: tv.quoted,
            });
          }
        }
      }
      offset += rawLine.length + 1;
      return;
    }

    if (!t) { flushPara(); offset += rawLine.length + 1; return; }

    if (paraStart < 0) paraStart = lineStart;
    paraEnd = lineStart + line.length;
    offset += rawLine.length + 1;
  });
  flushPara();

  warnings.push(
    "Nama di [name ...] dan teks di [sel_text ...] ikut diterjemahkan. " +
    "Perintah lain ([...]) jangan diubah."
  );
  return { segments, warnings };
}

export function applyArtemis(original, segments) {
  const sorted = [...segments]
    .filter((s) => s.translation !== "" && s.translation != null && s.start >= 0)
    .sort((a, b) => b.start - a.start);
  let out = original;
  for (const s of sorted) {
    let tr = s.translation;
    // Nilai atribut tanpa kutip yang mengandung spasi harus dikutip ulang
    if (s.quoted === false && /[\s\]]/.test(tr) && !(tr.startsWith('"') && tr.endsWith('"'))) {
      tr = `"${tr}"`;
    }
    out = out.slice(0, s.start) + tr + out.slice(s.end);
  }
  return out;
}

export const ARTEMIS = {
  id: "artemis",
  name: "Artemis Engine",
  exts: [".txt"],
  status: "supported",
  description: "Artemis .txt (format teks mirip KAG). .ast didukung terpisah; .asb biner belum.",
  parse: parseArtemis,
  apply: applyArtemis,
};
