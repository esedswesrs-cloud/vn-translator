/* Parser Ren'Py (.rpy)
 * Mengekstrak say-statement: [speaker] "teks" [:]
 * - Mendukung narasi ("teks"), dialog (e "teks"), dan pilihan menu ("teks":)
 * - Menangani escaped quotes (\") dan mengumpulkan define Character untuk nama pembicara
 * - Melewati blok python ($, init python:), komentar (#), dan blok terjemahan old/new
 */

function unescapeRenpy(s) {
  return s.replace(/\\(.)/g, "$1");
}

function escapeRenpy(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/* Kata yang bila diikuti string BUKAN teks tampil — jangan diekstrak sebagai segmen.
 * - old/new: blok translate strings
 * - scene/show/voice/play/queue/stop/add: nama gambar/file suara (bila pakai tanda kutip)
 * - properti screen-language: auto/idle/hover/... = path gambar;
 *   style_prefix/style/at/id/as/size_group/variant = nama style/identifier/keyword;
 *   color/font = kode warna/path font; scrollbars/adjustment/dsb = keyword.
 *   (Menerjemahkan ini merusak game, mis. "Imagebutton does not have a idle image"
 *   atau style/warna ngaco.)
 * Yang TETAP diekstrak: text/label/textbutton/pilihan menu/narasi/dialog. */
const SKIP_SPEAKERS = new Set([
  "old", "new",
  "scene", "show", "voice", "play", "queue", "stop", "add",
  "auto", "idle", "hover", "selected_idle", "selected_hover", "insensitive",
  "empty", "full", "thumb", "thumb_shadow", "foreground", "background",
  "activate_sound", "hover_sound", "selected_activate_sound",
  "style", "style_prefix", "at", "id", "as", "size_group", "variant",
  "color", "font", "scrollbars", "adjustment", "default", "value", "range",
]);

export function parseRenpy(text) {
  const segments = [];
  const warnings = [];

  // Kumpulkan define Character("Nama Tampil") untuk resolusi nama pembicara
  const charMap = {};
  const defRe = /^[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*Character\([ \t]*"((?:[^"\\]|\\.)*)"/gm;
  let dm;
  while ((dm = defRe.exec(text)) !== null) {
    charMap[dm[1]] = unescapeRenpy(dm[2]);
  }

  const lines = text.split("\n");
  let offset = 0;
  let skippedMultiline = 0;

  // Validasi: duplikat "old" dalam blok "translate <lang> strings:" bikin game crash
  // (Ren'Py: 'A translation for "..." already exists'). Terdeteksi di sini agar
  // pengguna tahu sebelum ekspor.
  let stringsLang = null;
  const seenOld = new Map(); // "lang\0old" -> nomor baris pertama

  lines.forEach((rawLine, idx) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineNo = idx + 1;

    // Lacak blok translate <lang> strings:
    const tsMatch = /^[ \t]*translate[ \t]+([A-Za-z_]\w*)[ \t]+strings[ \t]*:/.exec(line);
    if (tsMatch) {
      stringsLang = tsMatch[1];
    } else if (stringsLang && /^[^\s#]/.test(line)) {
      stringsLang = null; // baris tanpa indentasi -> keluar dari blok
    }

    // Lewati triple-quoted string (didukung sebagian: beri peringatan)
    if (/"""/.test(line) || /'''/.test(line)) {
      skippedMultiline++;
    }

    const sayRe = /^[ \t]*(?:([A-Za-z_]\w*)[ \t]+)?("(?:[^"\\]|\\.)*")([ \t]*:)?([ \t]*(?:#.*)?)?$/;
    const m = sayRe.exec(line);
    if (m) {
      const speakerVar = m[1] || "";
      // Baris "new" dalam blok "translate <lang> strings:" ADALAH teks terjemahan
      // yang bisa diterjemahkan lagi (mis. Vietnam -> Indonesia) — ekstrak sebagai segmen.
      const isStringsNew = speakerVar === "new" && stringsLang;
      if (SKIP_SPEAKERS.has(speakerVar) && !isStringsNew) {
        // blok terjemahan old/new -> lewati, tapi validasi duplikat old
        if (speakerVar === "old" && stringsLang) {
          const oldText = unescapeRenpy(m[2].slice(1, -1));
          const dupKey = stringsLang + "\0" + oldText;
          if (seenOld.has(dupKey)) {
            const prev = seenOld.get(dupKey);
            const snippet = oldText.length > 60 ? oldText.slice(0, 60) + "…" : oldText;
            warnings.push(
              `Duplikat terjemahan (${stringsLang}) di baris ${lineNo} — sama dengan baris ${prev}: "${snippet}". ` +
              `Game akan error ("already exists"). Hapus salah satu pasangan old/new.`
            );
          } else {
            seenOld.set(dupKey, lineNo);
          }
        }
      } else {
        const quoted = m[2];
        const qIdx = line.indexOf(quoted);
        const start = offset + qIdx;
        const end = start + quoted.length;
        const isChoice = !!m[3];
        segments.push({
          key: `renpy:L${lineNo}`,
          line: lineNo,
          speaker: isStringsNew ? `new (${stringsLang})` : speakerVar ? charMap[speakerVar] || speakerVar : "",
          speakerVar,
          kind: isStringsNew ? "string-translation" : isChoice ? "choice" : speakerVar ? "dialogue" : "narration",
          source: unescapeRenpy(quoted.slice(1, -1)),
          translation: "",
          start,
          end,
        });
      }
    }
    // String non-ASCII di baris Python ($): modder sering menaruh teks tampil
    // langsung di kode, mis. $ x = renpy.input("Bạn muốn...?"). String ASCII
    // murni (identifier seperti "monday"/"pre_esc") dilewati — bukan teks tampil.
    if (/^[ \t]*\$/.test(line)) {
      const pyStrRe = /"((?:[^"\\]|\\.)*[^\x00-\x7F](?:[^"\\]|\\.)*)"/g;
      let pm;
      while ((pm = pyStrRe.exec(line)) !== null) {
        const qIdx = pm.index;
        segments.push({
          key: `renpy:L${lineNo}$${qIdx}`,
          line: lineNo,
          speaker: "$",
          speakerVar: "$",
          kind: "python-string",
          source: unescapeRenpy(pm[1]),
          translation: "",
          start: offset + qIdx,
          end: offset + qIdx + pm[0].length,
        });
      }
    }
    offset += rawLine.length + 1;
  });

  if (skippedMultiline > 0) {
    warnings.push(
      `${skippedMultiline} baris mengandung triple-quoted string yang belum didukung dan dilewati.`
    );
  }

  return { segments, warnings };
}

export function applyRenpy(original, segments) {
  // Ganti dari belakang agar offset tetap valid
  const sorted = [...segments]
    .filter((s) => s.translation !== "" && s.translation != null)
    .sort((a, b) => b.start - a.start);
  let out = original;
  for (const s of sorted) {
    const rendered = `"${escapeRenpy(s.translation)}"`;
    out = out.slice(0, s.start) + rendered + out.slice(s.end);
  }
  return out;
}

export const RENPY = {
  id: "renpy",
  name: "Ren'Py",
  exts: [".rpy"],
  status: "supported",
  description: "Say-statement, narasi, dan pilihan menu (.rpy).",
  parse: parseRenpy,
  apply: applyRenpy,
};
