/* Parser TyranoBuilder / TyranoScript (.ks)
 * Sintaks mirip KAG (Kirikiri), dengan tambahan khas TyranoScript:
 * - baris "#Nama"  -> deklarasi nama pembicara; namanya ikut jadi segmen
 *                     terjemahan (nama tampil di name box)
 * - blok [iscript]...[endscript] -> JavaScript mentah, dilewati
 * - baris kosong, komentar (;), label (*), macro (@) -> dilewati
 * - baris yang hanya berisi tag [...] -> dilewati
 * Tag inline ([r], [p], [font ...], [chara_*], dsb.) dipertahankan.
 *
 * Dua pass: pertama tentukan segmen per baris, kedua hitung offset akurat
 * untuk rebuild yang aman.
 */

const TAG_ONLY_RE = /^\[[^\]]*\]\s*$/;

export function parseTyrano(text) {
  const lines = text.split("\n");
  // Pass 1: tentukan baris mana yang jadi segmen (tanpa offset)
  const items = [];
  let speaker = "";
  let inIscript = false;
  let skippedScript = 0;
  lines.forEach((rawLine, idx) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineNo = idx + 1;
    const t = line.trim();
    if (/^\[iscript/i.test(t)) { inIscript = true; return; }
    if (/^\[endscript/i.test(t)) { inIscript = false; return; }
    if (inIscript) { skippedScript++; return; }
    if (!t) return;
    if (t.startsWith(";") || t.startsWith("*") || t.startsWith("@")) return;
    if (TAG_ONLY_RE.test(t)) return;
    if (t.startsWith("#")) {
      const name = t.slice(1).trim();
      speaker = name;
      if (name) items.push({ type: "name", lineNo, line, name });
      return;
    }
    items.push({ type: "message", lineNo, line, speaker });
  });
  // Pass 2: hitung offset akurat
  const segments = [];
  let offset = 0;
  const byLine = new Map();
  items.forEach((it) => {
    if (!byLine.has(it.lineNo)) byLine.set(it.lineNo, []);
    byLine.get(it.lineNo).push(it);
  });
  lines.forEach((rawLine, idx) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineNo = idx + 1;
    const list = byLine.get(lineNo) || [];
    for (const it of list) {
      if (it.type === "name") {
        const nameIdx = line.indexOf(it.name, line.indexOf("#"));
        segments.push({
          key: `tyrano:name:L${lineNo}`,
          line: lineNo, speaker: "", speakerVar: "", kind: "name",
          source: it.name, translation: "",
          start: offset + nameIdx, end: offset + nameIdx + it.name.length,
        });
      } else {
        segments.push({
          key: `tyrano:L${lineNo}`,
          line: lineNo, speaker: it.speaker, speakerVar: "", kind: "message",
          source: line, translation: "",
          start: offset, end: offset + line.length,
        });
      }
    }
    offset += rawLine.length + 1;
  });

  const warnings = [];
  if (skippedScript > 0) {
    warnings.push(
      `${skippedScript} baris di dalam blok [iscript] dilewati (kode JavaScript, bukan teks).`
    );
  }
  warnings.push(
    "Baris \"#Nama\" adalah nama pembicara dan ikut diterjemahkan; " +
      "jangan ubah ID karakter di dalam tag seperti [chara_show]."
  );
  if (segments.some((s) => s.kind === "message" && /\[[^\]]+\]/.test(s.source))) {
    warnings.push(
      "Beberapa baris mengandung tag inline ([r], [p], [font], ...). " +
        "Jangan hapus atau ubah tag tersebut saat menerjemahkan."
    );
  }
  return { segments, warnings };
}

export function applyTyrano(original, segments) {
  const sorted = [...segments]
    .filter((s) => s.translation !== "" && s.translation != null)
    .sort((a, b) => b.start - a.start);
  let out = original;
  for (const s of sorted) {
    out = out.slice(0, s.start) + s.translation + out.slice(s.end);
  }
  return out;
}

export const TYRANO = {
  id: "tyrano",
  name: "TyranoBuilder (TyranoScript)",
  exts: [".ks"],
  status: "supported",
  description: "TyranoScript .ks; baris #Nama jadi segmen nama pembicara.",
  parse: parseTyrano,
  apply: applyTyrano,
};
