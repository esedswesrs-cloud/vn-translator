/* Pindai folder: klasifikasikan file mana yang bisa diterjemahkan.
 * Dipakai fitur "Upload Folder". Logika murni (tanpa DOM) agar bisa diuji di Node.
 */
import { detectEngine } from "./engines.js";

export const FOLDER_TEXT_LIMIT = 8 * 1024 * 1024; // sama dengan batas upload file teks

// Ekstensi yang jelas-jelas bukan script — dilewati tanpa dibaca isinya
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg", ".tga",
  ".ogg", ".mp3", ".wav", ".flac", ".m4a", ".opus", ".mid",
  ".mp4", ".avi", ".mov", ".mkv", ".webm",
  ".exe", ".dll", ".so", ".dylib",
  ".ttf", ".otf", ".woff", ".woff2",
  ".pdf", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".psd",
]);

function extOf(path) {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* Heuristik biner: teks script asli praktis tidak mengandung NUL / replacement char.
 * Mencegah script terkompilasi (.scn biner dsb.) lolos sebagai "bisa diterjemahkan". */
function looksBinary(text) {
  if (text.includes("\0")) return true;
  let bad = 0;
  const n = Math.min(text.length, 20000);
  for (let i = 0; i < n; i++) if (text.charCodeAt(i) === 0xfffd) bad++;
  return bad > n * 0.02;
}

/* files: array mirip File { name, size, webkitRelativePath?, arrayBuffer() }
 * deps: { decodeBuffer(buf) -> { text, encoding } }
 * onProgress(done, total)
 * return { ok:[{file,path,size,engine}], archives:[{file,path,size,kind}],
 *          rpyc:[{file,path,size}], rpa:[{file,path,size}], pfs:[{file,path,size}],
 *          skipped:[{path,size,reason}] }
 */
export async function scanFolder(files, deps, onProgress) {
  const ok = [], archives = [], rpyc = [], rpa = [], pfs = [], skipped = [];
  const total = files.length;
  let done = 0;
  for (const f of files) {
    done++;
    if (onProgress && (done % 5 === 0 || done === total)) {
      onProgress(done, total);
      await tick();
    }
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    const lower = rel.toLowerCase();
    const ext = extOf(lower);

    if (lower.endsWith(".ypf") || lower.endsWith(".xp3")) {
      archives.push({ file: f, path: rel, size: f.size, kind: lower.endsWith(".ypf") ? "ypf" : "xp3" });
      continue;
    }
    // .rpa (Ren'Py) & .pfs (Artemis): dikumpulkan terpisah — bisa diekstrak langsung di web
    if (ext === ".rpa") { rpa.push({ file: f, path: rel, size: f.size }); continue; }
    if (ext === ".pfs") { pfs.push({ file: f, path: rel, size: f.size }); continue; }
    // .rpyc: dikumpulkan terpisah — bisa di-decompile langsung di web
    if (ext === ".rpyc") { rpyc.push({ file: f, path: rel, size: f.size }); continue; }
    if (BINARY_EXTS.has(ext)) { skipped.push({ path: rel, size: f.size, reason: "file media/biner" }); continue; }
    if (f.size === 0) { skipped.push({ path: rel, size: 0, reason: "file kosong" }); continue; }
    if (f.size > FOLDER_TEXT_LIMIT) { skipped.push({ path: rel, size: f.size, reason: "terlalu besar (>8 MB)" }); continue; }
    if (lower.endsWith(".ybn")) { skipped.push({ path: rel, size: f.size, reason: "script YU-RIS — buka lewat arsip .ypf" }); continue; }

    let text;
    try {
      const buf = await f.arrayBuffer();
      ({ text } = await deps.decodeBuffer(buf));
    } catch (e) {
      skipped.push({ path: rel, size: f.size, reason: "tidak bisa dibaca" });
      continue;
    }
    if (looksBinary(text)) { skipped.push({ path: rel, size: f.size, reason: "file biner/terkompilasi" }); continue; }
    const { engine } = detectEngine(rel, text);
    if (!engine) { skipped.push({ path: rel, size: f.size, reason: "format tidak dikenal" }); continue; }
    // Validasi ringan: pastikan parser benar-benar menghasilkan segmen teks
    // (nama file ikut dikirim — sebagian parser butuh itu, mis. RPG Maker)
    try {
      const { segments } = engine.parse(text, rel);
      if (!segments || segments.length === 0) {
        skipped.push({ path: rel, size: f.size, reason: "tidak ada teks untuk diterjemahkan" });
        continue;
      }
    } catch (e) {
      skipped.push({ path: rel, size: f.size, reason: "tidak bisa di-parse" });
      continue;
    }
    ok.push({ file: f, path: rel, size: f.size, engine });
  }
  return { ok, archives, rpyc, rpa, pfs, skipped };
}
