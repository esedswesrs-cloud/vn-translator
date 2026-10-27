/* VNTranslate — logika utama */
import { ENGINES, getEngine, detectEngine } from "./engines.js";
import { parseYpf } from "./parsers/ypf.js";
import { parseXp3 } from "./parsers/xp3.js";
import { parseYsc, parseYstb, rebuildYstb, joinSpeaker } from "./parsers/yuris.js";
import { MT_PROVIDERS, getProvider, translateBatch, proofreadBatch, LANGS, SOURCE_LANGS, GEMINI_MODELS, GEMINI_MODEL_ALIAS } from "./mt.js";
import { scanFolder } from "./folder.js";
import { analyzeGame, analysisCardHTML } from "./analyze.js";
import { decompileRpycBuffer } from "./decompile.js";
import {
  listProjects, saveProject, getProject, deleteProject,
  loadSettings, saveSettings, loadKeys, saveKeys, newId,
  downloadFile, toCSV,
} from "./store.js";
import { tcacheGet, tcachePut, tcacheDel, tcacheCleanup, TCACHE_TTL } from "./tcache.js";

const $ = (id) => document.getElementById(id);

/* Versi build — NAIKKAN tiap deploy. Dipakai untuk cache-busting dynamic
 * import(): tanpa ini, browser bisa memakai modul lama dari cache (mis.
 * pfs.js tanpa rebuildPfs) sementara app.js sudah baru -> "X is not a function". */
const APP_VER = "1.77";
const withVer = (p) => `${p}?v=${APP_VER}`;

/* ---------- state ---------- */
let project = null;          // proyek aktif
let settings = loadSettings();
// Provider yang sudah tidak ada (mis. dihapus) -> kembalikan ke default
if (!getProvider(settings.providerId)) settings.providerId = "mymemory";
let keys = loadKeys();
let searchTerm = "";
let filterMode = "all";
let saveTimer = null;

/* ---------- util ---------- */
function toast(msg, isError = false, ms = 2600) {
  const bar = $("statusbar");
  bar.textContent = msg;
  bar.className = "statusbar show" + (isError ? " error" : "");
  clearTimeout(bar._t);
  bar._t = setTimeout(() => (bar.className = "statusbar"), ms);
}
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- navigasi ---------- */
document.querySelectorAll("nav.tabs button").forEach((b) => {
  b.addEventListener("click", () => showView(b.dataset.view));
});
function showView(name) {
  document.querySelectorAll("nav.tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === "view-" + name));
  /* HP: tab aktif digeser ke tengah strip + halaman lompat ke atas konten */
  if (window.matchMedia("(max-width: 760px)").matches) {
    const btn = document.querySelector(`nav.tabs button[data-view="${name}"]`);
    if (btn) btn.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (name === "engines") renderEngines();
  if (name === "home") renderProjectList();
  if (name === "editor") renderEditor();
  if (name === "archive") renderArchive();
  if (name === "settings") renderSettings();
}

/* ---------- encoding ---------- */
async function decodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder("utf-8").decode(bytes.slice(3)), encoding: "utf-8-sig" };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: new TextDecoder("utf-16le").decode(bytes.slice(2)), encoding: "utf-16le" };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: new TextDecoder("utf-16be").decode(bytes.slice(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("shift-jis").decode(bytes), encoding: "shift-jis" };
  }
}

function encodeForDownload(text, encoding) {
  // Kembalikan Shift-JIS jika aslinya SJIS dan pustaka tersedia; jika tidak, UTF-8
  if (encoding === "shift-jis" && typeof Encoding !== "undefined") {
    try {
      const codes = Encoding.stringToCode(text);
      const sjis = Encoding.convert(codes, { to: "SJIS", from: "UNICODE" });
      return { bytes: new Uint8Array(sjis), encoding: "shift-jis" };
    } catch { /* jatuh ke UTF-8 */ }
  }
  return { bytes: new TextEncoder().encode(text), encoding: "utf-8" };
}

/* ---------- upload ---------- */
const dz = $("dropzone"), fi = $("fileInput");
dz.addEventListener("click", () => fi.click());
["dragover", "dragenter"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", (ev) => {
  const item = ev.dataTransfer.items && ev.dataTransfer.items[0];
  const entry = item && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
  if (entry && entry.isDirectory) { collectEntryFiles(entry).then((fs) => { if (fs.length) handleFolder(fs); }); return; }
  const f = ev.dataTransfer.files[0];
  if (f) handleFile(f);
});
fi.addEventListener("change", () => { if (fi.files[0]) handleFile(fi.files[0]); fi.value = ""; });

/* ---------- upload folder: pindai & sortir file yang bisa diterjemahkan ---------- */
let folderRows = []; // baris hasil pindai utk tombol aksi

const folderInput = $("folderInput");
$("btnFolder").addEventListener("click", () => folderInput.click());
folderInput.addEventListener("change", () => { if (folderInput.files.length) handleFolder([...folderInput.files]); folderInput.value = ""; });

async function collectEntryFiles(dirEntry, basePath = "") {
  const out = [];
  const reader = dirEntry.createReader();
  const entries = await new Promise((res, rej) => {
    const acc = [];
    const read = () => reader.readEntries((es) => { if (!es.length) return res(acc); acc.push(...es); read(); }, rej);
    read();
  });
  for (const e of entries) {
    const rel = basePath ? basePath + "/" + e.name : e.name;
    if (e.isFile) {
      const f = await new Promise((res, rej) => e.file(res, rej));
      Object.defineProperty(f, "webkitRelativePath", { value: rel });
      out.push(f);
    } else if (e.isDirectory) {
      out.push(...await collectEntryFiles(e, rel));
    }
  }
  return out;
}

async function handleFolder(files) {
  const firstRel = (files[0] && (files[0].webkitRelativePath || files[0].name)) || "";
  const folderName = firstRel.split("/")[0] || "folder";
  $("uploadInfo").innerHTML =
    `<div class="notice blue"><strong>📁 Memindai ${escHtml(folderName)}...</strong><br><span id="folderProg">0/${files.length} file</span></div>`;
  const res = await scanFolder(files, { decodeBuffer }, (d, t) => {
    const el = $("folderProg"); if (el) el.textContent = `${d}/${t} file`;
  });
  batchDone.clear(); // folder baru -> progres batch diulang dari nol
  polishedDone.clear();
  virtualRows = [];  // hasil decompile sesi sebelumnya dibuang
  translatedOutputs = new Map();
  translatedSegments = new Map();
  extractedArchives = new Map();
  renderFolderResults(folderName, files.length, res);
}

async function openFolderFile(row) {
  toast("Membaca file...");
  const buf = await row.file.arrayBuffer();
  const { text, encoding } = await decodeBuffer(buf);
  startProject(row.path, text, row.encoding || encoding, row.engine);
  // Jika file ini sudah diterjemahkan sebelumnya (tombol Terjemahkan/batch),
  // tampilkan hasil terjemahannya di editor agar bisa diperiksa/dikoreksi.
  const prev = translatedSegments.get(row.path);
  if (prev && project && project.fileName === row.path) {
    const tm = new Map();
    for (const s of prev) if (s.translation && s.translation.trim()) tm.set(s.key, s.translation);
    let n = 0;
    for (const s of project.segments) {
      const t = tm.get(s.key);
      if (t && t.trim() && (!s.translation || !s.translation.trim())) { s.translation = t; n++; }
    }
    if (n > 0) {
      saveProject(project);
      renderEditor();
      toast(`${n} terjemahan dimuat — silakan periksa/koreksi lalu Ekspor.`, false, 4000);
    }
  }
}

/* Terjemahkan 1 file langsung di daftar (tanpa buka editor).
 * File ditandai ✅ dan batch berikutnya akan melewatinya (hemat kuota).
 * File dari arsip TIDAK diunduh otomatis — hasilnya tersimpan untuk
 * kemas ulang; file lepas diunduh seperti biasa (atau digabung ke ZIP
 * saat dipanggil dari batch via opts.fromBatch).
 * Mengembalikan true bila sukses/dilewati, false bila gagal. */
let singleTranslating = false;
async function translateSingleFile(idx, btn, opts = {}) {
  const row = folderRows[idx];
  const fromBatch = !!opts.fromBatch;
  if (!row || row.archive) return false;
  if (!fromBatch && (singleTranslating || batchRunning)) return false;
  const prov = getProvider(settings.providerId);
  if (prov.needsKey && !(keys[settings.providerId] || "").trim()) {
    if (!fromBatch) toast(`Isi dulu API key ${prov.name} di tab Pengaturan.`, true, 4000);
    return false;
  }
  if (batchDone.has(row.path)) { if (!fromBatch) toast("File ini sudah diterjemahkan ✅", false, 2500); return true; }
  singleTranslating = true;
  const oldLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Menerjemahkan…"; }
  try {
    const buf = await row.file.arrayBuffer();
    const { text, encoding } = await decodeBuffer(buf);
    const { segments } = row.engine.parse(text, row.path);
    const todo = segments.filter((s) => s.source && s.source.trim());
    if (!todo.length) { if (!fromBatch) toast("Tidak ada baris untuk diterjemahkan.", true); return true; }
    // Pakai terjemahan yang sudah ada di editor (jika file sedang dibuka)
    let needMt = todo;
    if (project && project.fileName === row.path && project.segments) {
      const em = new Map();
      for (const s of project.segments) if (s.translation && s.translation.trim()) em.set(s.key, s.translation);
      if (em.size) {
        for (const s of todo) if (em.has(s.key)) s.translation = em.get(s.key);
        needMt = todo.filter((s) => !s.translation || !s.translation.trim());
      }
    }
    if (needMt.length) {
      const out = await translateBatch({
        ...batchMtArgs(),
        texts: needMt.map((s) => s.source),
        onProgress: (d, t) => { if (btn) btn.textContent = `Menerjemahkan… ${d}/${t}`; },
        onWait: (s) => { if (btn) btn.textContent = `⏳ Limit — jeda ${s} dtk, lanjut otomatis…`; },
      });
      needMt.forEach((s, k) => { s.translation = out[k]; });
    }
    const applied = row.engine.apply(text, segments);
    const { bytes } = encodeForDownload(applied, row.encoding || encoding);
    translatedOutputs.set(row.path, bytes); // simpan untuk kemas ulang arsip
    translatedSegments.set(row.path, segments.map((s) => ({ ...s }))); // simpan agar bisa dibuka di editor
    batchDone.add(row.path);
    polishedDone.delete(row.path); // terjemahan baru -> layak dipoles lagi
    persistTranslation(row, segments, bytes); // simpan ke cache 24 jam (tahan refresh)
    const mark = document.querySelector(`#uploadInfo [data-fdone="${CSS.escape(row.path)}"]`);
    if (mark) mark.textContent = "✅";
    refreshRepackButtons(row.archivePath);
    if (!fromBatch) {
      if (row.archivePath) {
        // file dari arsip: TIDAK diunduh otomatis — hasil dikemas ulang nanti
        toast(`Selesai ✅ — hasil tersimpan. Klik Edit untuk memeriksa/koreksi.`, false, 3500);
      } else {
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = row.path.split("/").pop();
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        toast(`Selesai: ${a.download} diunduh ✅`, false, 3500);
      }
    }
    return true;
  } catch (e) {
    toast(`Gagal: ${row ? row.path : "?"} — ${e.message}`, true, 6000);
    return false;
  } finally {
    singleTranslating = false;
    if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
  }
}

/* Baris virtual: .rpy hasil decompile .rpyc (in-memory, ikut alur terjemahan normal).
 * rpycRows: file .rpyc yang belum di-decompile.
 * rpaRows/pfsRows: arsip .rpa/.pfs yang belum diekstrak. */
let virtualRows = [], rpycRows = [], rpaRows = [], pfsRows = [], lastFolderScan = null;
let translatedOutputs = new Map(); // path file virtual -> Uint8Array hasil terjemahan akhir
let translatedSegments = new Map(); // path -> segmen berterjemahan (untuk dibuka di editor)
let extractedArchives = new Map(); // path arsip -> { file, kind } (arsip asli untuk kemas ulang)

function renderFolderResults(folderName, total, { ok, archives, rpyc = [], rpa = [], pfs = [], skipped }) {
  folderRows = [];
  lastFolderScan = { folderName, total, res: { ok, archives, rpyc, rpa, pfs, skipped } };
  rpycRows = rpyc.slice().sort((a, b) => a.path.localeCompare(b.path));
  rpaRows = rpa.slice().sort((a, b) => a.path.localeCompare(b.path));
  pfsRows = pfs.slice().sort((a, b) => a.path.localeCompare(b.path));
  ok.sort((a, b) => a.path.localeCompare(b.path));
  archives.sort((a, b) => a.path.localeCompare(b.path));
  const byEngine = new Map();
  for (const o of [...ok, ...virtualRows]) {
    if (!byEngine.has(o.engine.id)) byEngine.set(o.engine.id, { engine: o.engine, items: [] });
    byEngine.get(o.engine.id).items.push(o);
  }
  let html = "";
  // Analisis game: tebak engine dari struktur folder + panduan upload & langkah
  try {
    const allPaths = [
      ...ok.map((o) => o.path),
      ...archives.map((a) => a.path),
      ...skipped.map((s) => s.path),
    ];
    const analysis = analyzeGame(allPaths, { ok, archives });
    const engName = analysis.known ? (getEngine(analysis.best.id) || {}).name || analysis.best.id : "";
    html += analysisCardHTML(analysis, engName);
  } catch { /* analisis opsional, jangan ganggu hasil pindai */ }
  html +=
    `<div class="notice blue" style="margin-top:10px"><strong>📁 ${escHtml(folderName)}</strong> — ${total} file dipindai<br>` +
    `✅ <strong>${ok.length + virtualRows.length}</strong> bisa diterjemahkan · 📦 <strong>${archives.length}</strong> arsip · 🔧 <strong>${rpycRows.length}</strong> .rpyc · 📦 <strong>${rpaRows.length}</strong> .rpa · 📦 <strong>${pfsRows.length}</strong> .pfs · ⏭️ <strong>${skipped.length}</strong> dilewati</div>`;
  if (ok.length === 0 && archives.length === 0 && rpycRows.length === 0 && rpaRows.length === 0 && pfsRows.length === 0 && virtualRows.length === 0) {
    html += `<div class="notice">Tidak ada file yang bisa diterjemahkan di folder ini.</div>`;
  }
  for (const { engine, items } of byEngine.values()) {
    html += `<div class="card" style="margin-top:10px"><h3 class="grouphead" style="font-size:15px">${escHtml(engine.name)} <span class="muted">(${items.length})</span> <button class="btn" data-batch="${engine.id}" style="margin-left:8px">⚡ Terjemahkan semua otomatis</button><button class="btn" data-polish="${engine.id}" style="margin-left:8px">✨ Poles semua otomatis</button>${repackButtonsHtml(items, engine.id)}</h3>`;
    for (const o of items) {
      const idx = folderRows.length; folderRows.push(o);
      html += `<div class="filerow"><span class="bdone" data-fdone="${escHtml(o.path)}">${batchDone.has(o.path) ? "✅" : ""}</span><span class="path kbd">${escHtml(o.path)}</span>` +
        `<span class="sz">${fmtSize(o.size)}</span>` +
        `<button class="btn primary" data-mtrow="${idx}">Terjemahkan</button>` +
        `<button class="btn" data-frow="${idx}">Edit</button></div>`;
    }
    html += `</div>`;
  }
  if (archives.length) {
    html += `<div class="card" style="margin-top:10px"><h3 style="margin:0 0 6px;font-size:15px">📦 Arsip <span class="muted">(${archives.length})</span></h3>`;
    for (const a of archives) {
      const idx = folderRows.length; folderRows.push({ ...a, archive: true });
      html += `<div class="filerow"><span class="path kbd">${escHtml(a.path)}</span>` +
        `<span class="sz">${fmtSize(a.size)}</span>` +
        `<button class="btn" data-frow="${idx}">Buka arsip →</button></div>`;
    }
    html += `</div>`;
  }
  if (rpycRows.length) {
    html += `<div class="card" style="margin-top:10px"><h3 style="margin:0 0 6px;font-size:15px">🔧 .rpyc terkompilasi <span class="muted">(${rpycRows.length})</span> <button class="btn" data-derpyc-all style="margin-left:8px">Decompile semua</button></h3>` +
      `<div class="muted" style="font-size:12px;margin-bottom:4px">Script Ren'Py terkompilasi — decompile dulu langsung di browser, hasilnya masuk daftar terjemahan di atas.</div>`;
    rpycRows.forEach((r, i) => {
      html += `<div class="filerow"><span class="path kbd">${escHtml(r.path)}</span>` +
        `<span class="sz">${fmtSize(r.size)}</span>` +
        `<button class="btn" data-derpyc="${i}">Decompile →</button></div>`;
    });
    html += `</div>`;
  }
  if (rpaRows.length) {
    html += `<div class="card" style="margin-top:10px"><h3 style="margin:0 0 6px;font-size:15px">📦 Arsip .rpa (Ren'Py) <span class="muted">(${rpaRows.length})</span> <button class="btn" data-xrpa-all style="margin-left:8px">Ekstrak semua</button></h3>` +
      `<div class="muted" style="font-size:12px;margin-bottom:4px">Arsip Ren'Py — ekstrak langsung di browser, script .rpyc di dalamnya otomatis di-decompile dan masuk daftar terjemahan di atas.</div>` +
      `<div class="notice" style="font-size:12px">ℹ️ <strong>.rpa tidak bisa dikemas ulang</strong> — Ren'Py mengabaikan file <span class="kbd">.rpy</span> di dalam arsip (hanya <span class="kbd">.rpyc</span> yang dibaca). Cara yang benar: taruh file <span class="kbd">.rpy</span> hasil terjemahan langsung di folder <span class="kbd">game/</span> — Ren'Py otomatis mengompilasinya saat game dijalankan.</div>`;
    rpaRows.forEach((r, i) => {
      html += `<div class="filerow"><span class="path kbd">${escHtml(r.path)}</span>` +
        `<span class="sz">${fmtSize(r.size)}</span>` +
        `<button class="btn" data-xrpa="${i}">Ekstrak →</button></div>`;
    });
    html += `</div>`;
  }
  if (pfsRows.length) {
    html += `<div class="card" style="margin-top:10px"><h3 style="margin:0 0 6px;font-size:15px">📦 Arsip .pfs (Artemis) <span class="muted">(${pfsRows.length})</span> <button class="btn" data-xpfs-all style="margin-left:8px">Ekstrak semua</button></h3>` +
      `<div class="muted" style="font-size:12px;margin-bottom:4px">Arsip Artemis — ekstrak langsung di browser, script .ast/.txt di dalamnya masuk daftar terjemahan di atas.</div>`;
    pfsRows.forEach((r, i) => {
      html += `<div class="filerow"><span class="path kbd">${escHtml(r.path)}</span>` +
        `<span class="sz">${fmtSize(r.size)}</span>` +
        `<button class="btn" data-xpfs="${i}">Ekstrak →</button></div>`;
    });
    html += `</div>`;
  }
  if (skipped.length) {
    const rows = skipped.slice().sort((a, b) => a.path.localeCompare(b.path)).map((s) =>
      `<div class="filerow"><span class="path kbd">${escHtml(s.path)}</span>` +
      `<span class="sz">${fmtSize(s.size)}</span><span class="why">${escHtml(s.reason)}</span></div>`).join("");
    html += `<details class="card folderskip" style="margin-top:10px"><summary>⏭️ File dilewati (${skipped.length})</summary><div style="margin-top:6px">${rows}</div></details>`;
  }
  $("uploadInfo").innerHTML = html;
  document.querySelectorAll("#uploadInfo [data-frow]").forEach((b) =>
    b.addEventListener("click", () => {
      const row = folderRows[+b.dataset.frow];
      if (row.archive) handleFile(row.file); else openFolderFile(row);
    }));
  document.querySelectorAll("#uploadInfo [data-mtrow]").forEach((b) =>
    b.addEventListener("click", () => translateSingleFile(+b.dataset.mtrow, b)));
  document.querySelectorAll("#uploadInfo [data-repack]").forEach((b) =>
    b.addEventListener("click", () => repackArchive(b.dataset.repack)));
  document.querySelectorAll("#uploadInfo [data-patchxp3]").forEach((b) =>
    b.addEventListener("click", buildPatchXp3));
  document.querySelectorAll("#uploadInfo [data-batch]").forEach((b) =>
    b.addEventListener("click", () => {
      const eng = getEngine(b.dataset.batch);
      if (eng) batchTranslateGroup(eng.id, eng.name);
    }));
  document.querySelectorAll("#uploadInfo [data-polish]").forEach((b) =>
    b.addEventListener("click", () => {
      const eng = getEngine(b.dataset.polish);
      if (eng) batchPolishGroup(eng.id, eng.name);
    }));
  document.querySelectorAll("#uploadInfo [data-derpyc]").forEach((b) =>
    b.addEventListener("click", () => decompileRpycRow(+b.dataset.derpyc, b)));
  const deAll = document.querySelector("#uploadInfo [data-derpyc-all]");
  if (deAll) deAll.addEventListener("click", () => decompileAllRpyc(deAll));
  document.querySelectorAll("#uploadInfo [data-xrpa]").forEach((b) =>
    b.addEventListener("click", () => extractRpaRow(+b.dataset.xrpa, b)));
  const xrpaAll = document.querySelector("#uploadInfo [data-xrpa-all]");
  if (xrpaAll) xrpaAll.addEventListener("click", () => extractAllRpa(xrpaAll));
  document.querySelectorAll("#uploadInfo [data-xpfs]").forEach((b) =>
    b.addEventListener("click", () => extractPfsRow(+b.dataset.xpfs, b)));
  const xpfsAll = document.querySelector("#uploadInfo [data-xpfs-all]");
  if (xpfsAll) xpfsAll.addEventListener("click", () => extractAllPfs(xpfsAll));
  // Pulihkan hasil terjemahan sesi sebelumnya (cache 24 jam) — tanpa pakai kuota API.
  // Fire-and-forget: tidak memblokir tampilan hasil pindai.
  restoreCacheForRows().catch(() => {});
}

/* ---------- decompile .rpyc -> .rpy virtual (masuk daftar terjemahan) ---------- */
let decompiling = false;

async function decompileOneRpyc(r) {
  const buf = await r.file.arrayBuffer();
  const text = await decompileRpycBuffer(buf);
  const rpyPath = r.path.replace(/\.rpyc$/i, ".rpy");
  const vf = new File([text], rpyPath.split("/").pop(), { type: "text/plain" });
  let eng = getEngine("renpy");
  try { const d = detectEngine(rpyPath, text); if (d.engine) eng = d.engine; } catch { /* pakai renpy */ }
  return { file: vf, path: rpyPath, size: vf.size, engine: eng, virtual: true };
}

function rerenderFolderResults() {
  if (!lastFolderScan) return;
  lastFolderScan.res.rpyc = rpycRows;
  lastFolderScan.res.rpa = rpaRows;
  lastFolderScan.res.pfs = pfsRows;
  renderFolderResults(lastFolderScan.folderName, lastFolderScan.total, lastFolderScan.res);
}

async function decompileRpycRow(idx, btn) {
  const r = rpycRows[idx];
  if (!r || decompiling) return;
  decompiling = true;
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Decompile…";
  try {
    virtualRows.push(await decompileOneRpyc(r));
    rpycRows.splice(idx, 1);
    rerenderFolderResults();
    toast("Decompile selesai — file .rpy masuk daftar terjemahan ✅", false, 3000);
  } catch (e) {
    toast(`Gagal decompile ${r.path}: ${e.message}`, true, 5000);
    btn.disabled = false; btn.textContent = old;
  } finally {
    decompiling = false;
  }
}

async function decompileAllRpyc(btn) {
  if (decompiling || !rpycRows.length) return;
  decompiling = true;
  btn.disabled = true;
  const n = rpycRows.length;
  let done = 0, fail = 0;
  while (rpycRows.length) {
    btn.textContent = `Decompile… ${done + 1}/${n}`;
    try {
      virtualRows.push(await decompileOneRpyc(rpycRows[0]));
      done++;
    } catch (e) { fail++; }
    rpycRows.shift();
  }
  decompiling = false;
  rerenderFolderResults();
  toast(`Decompile selesai: ${done} berhasil${fail ? `, ${fail} gagal` : ""}.`, fail > 0, 4000);
}

/* ---------- ekstrak .rpa / .pfs -> file virtual (masuk daftar terjemahan) ---------- */
let extracting = false;

function makeVirtualRow(vpath, text, engineId, encoding) {
  const vf = new File([text], vpath.split("/").pop(), { type: "text/plain" });
  let eng = getEngine(engineId);
  try { const d = detectEngine(vpath, text); if (d.engine) eng = d.engine; } catch { /* pakai default */ }
  return { file: vf, path: vpath, size: vf.size, engine: eng, virtual: true, encoding: encoding || null, archivePath: null };
}

async function extractOneRpa(r) {
  const buf = await r.file.arrayBuffer();
  const { listRpaScripts, readRpaScript } = await import(withVer("./extract.js"));
  const items = await listRpaScripts(buf);
  if (!items.length) throw new Error("tidak ada script .rpyc/.rpy di dalamnya");
  extractedArchives.set(r.path, { file: r.file, kind: "rpa" });
  const rows = [];
  let skipped = 0;
  for (const it of items) {
    try {
      const { text } = await readRpaScript(it);
      if (!text || !text.trim()) { skipped++; continue; }
      const vpath = `${r.path}/${it.path}`;
      const vr = makeVirtualRow(it.path.toLowerCase().endsWith(".rpyc") ? vpath.replace(/\.rpyc$/i, ".rpy") : vpath, text, "renpy");
      vr.archivePath = r.path;
      rows.push(vr);
    } catch { skipped++; }
  }
  return { rows, skipped, total: items.length };
}

async function extractRpaRow(idx, btn) {
  const r = rpaRows[idx];
  if (!r || extracting) return;
  extracting = true;
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Ekstrak…";
  try {
    const { rows, skipped, total } = await extractOneRpa(r);
    virtualRows.push(...rows);
    rpaRows.splice(idx, 1);
    rerenderFolderResults();
    toast(`Ekstrak selesai: ${rows.length}/${total} script masuk daftar${skipped ? `, ${skipped} dilewati` : ""} ✅`, false, 3500);
  } catch (e) {
    toast(`Gagal ekstrak ${r.path}: ${e.message}`, true, 5000);
    btn.disabled = false; btn.textContent = old;
  } finally {
    extracting = false;
  }
}

async function extractAllRpa(btn) {
  if (extracting || !rpaRows.length) return;
  extracting = true;
  btn.disabled = true;
  const n = rpaRows.length;
  let done = 0, fail = 0;
  while (rpaRows.length) {
    btn.textContent = `Ekstrak… ${done + 1}/${n}`;
    try {
      const { rows } = await extractOneRpa(rpaRows[0]);
      virtualRows.push(...rows);
      done++;
    } catch { fail++; }
    rpaRows.shift();
  }
  extracting = false;
  rerenderFolderResults();
  toast(`Ekstrak selesai: ${done} arsip${fail ? `, ${fail} gagal` : ""}.`, fail > 0, 4000);
}

/* ---------- kemas ulang arsip .pfs dari hasil terjemahan ----------
 * Tombol "📦 Kemas ulang" muncul di header tiap grup engine untuk arsip .pfs
 * yang sudah diekstrak. Hanya file bertanda ✅ (sudah diterjemahkan) yang
 * dimasukkan, dan tombol aktif hanya bila SEMUA file dari arsip itu ✅. */
function repackButtonsHtml(items, engineId) {
  const archPaths = [...new Set(items.map((o) => o.archivePath).filter(Boolean))];
  let out = "";
  for (const ap of archPaths) {
    const arch = extractedArchives.get(ap);
    if (!arch || arch.kind !== "pfs") continue;
    const base = ap.split("/").pop();
    const total = items.filter((o) => o.archivePath === ap).length;
    const done = items.filter((o) => o.archivePath === ap && batchDone.has(o.path)).length;
    const ready = total > 0 && done === total;
    out += ` <button class="btn${ready ? " primary" : ""}" data-repack="${escHtml(ap)}"${ready ? "" : " disabled"} style="margin-left:8px"` +
      ` title="${ready ? "Kemas semua file terjemahan kembali ke " + escHtml(base) : `${total - done} file belum diterjemahkan — tombol aktif setelah semuanya ✅`}">📦 Kemas ulang ${escHtml(base)}</button>` +
      ` <span class="muted" data-repackcount="${escHtml(ap)}" style="font-size:12px">${done}/${total} diterjemahkan</span>`;
  }
  // File .ks/.tjs lepas (hasil ekstrak PC) → buat patch.xp3
  if (engineId === "kirikiri") {
    const loose = items.filter((o) => !o.archivePath && /\.(ks|tjs)$/i.test(o.path));
    const done = loose.filter((o) => batchDone.has(o.path));
    if (loose.length > 0) {
      const ready = done.length > 0;
      out += ` <button class="btn${ready ? " primary" : ""}" data-patchxp3="1"${ready ? "" : " disabled"} style="margin-left:8px"` +
        ` title="${ready ? `Buat patch.xp3 dari ${done.length} file terjemahan` : "Terjemahkan dulu minimal 1 file .ks/.tjs"}">📦 Buat patch.xp3</button>` +
        ` <span class="muted" style="font-size:12px">${done.length}/${loose.length} diterjemahkan</span>`;
    }
  }
  return out;
}

/** Buat patch.xp3 dari file .ks/.tjs lepas yang sudah diterjemahkan (hasil ekstrak PC). */
async function buildPatchXp3() {
  const entries = [];
  for (const [path, bytes] of translatedOutputs) {
    if (!/\.(ks|tjs)$/i.test(path)) continue;
    if (!batchDone.has(path)) continue;
    entries.push({ path, bytes });
  }
  // nama dalam arsip: buang folder root bersama bila semua file di bawahnya
  let stripPrefix = "";
  if (entries.length > 0) {
    const firsts = entries.map((e) => e.path.split("/")[0]);
    if (firsts.every((f) => f === firsts[0]) && entries[0].path.includes("/")) {
      stripPrefix = firsts[0] + "/";
    }
  }
  const files = entries.map((e) => ({
    name: stripPrefix ? e.path.slice(stripPrefix.length) : e.path,
    data: e.bytes,
  }));
  if (!files.length) { toast("Belum ada file .ks/.tjs terjemahan.", true); return; }
  toast(`Membuat patch.xp3 dari ${files.length} file...`);
  try {
    const { buildXp3, parseXp3 } = await import(withVer("./parsers/xp3.js"));
    const out = buildXp3(files);
    const check = await parseXp3(out);
    if (check.files.length !== files.length) throw new Error("verifikasi gagal — jumlah entri berubah");
    const blob = new Blob([out], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "patch.xp3";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`📦 patch.xp3 dibuat (${files.length} file) ✅ — taruh di folder game (sejajar data.xp3).`, false, 8000);
  } catch (e) {
    console.error(e);
    toast("Gagal membuat patch.xp3: " + e.message, true, 6000);
  }
}

/** Segarkan status tombol kemas ulang setelah ada file yang selesai. */
function refreshRepackButtons(ap) {
  if (!ap) return;
  const arch = extractedArchives.get(ap);
  if (!arch || arch.kind !== "pfs") return;
  const items = folderRows.filter((o) => o.archivePath === ap);
  if (!items.length) return;
  const done = items.filter((o) => batchDone.has(o.path)).length;
  const ready = done === items.length;
  document.querySelectorAll("#uploadInfo [data-repack]").forEach((b) => {
    if (b.dataset.repack !== ap) return;
    b.disabled = !ready;
    b.classList.toggle("primary", ready);
    b.title = ready ? "Kemas semua file terjemahan kembali ke arsip" : `${items.length - done} file belum diterjemahkan — tombol aktif setelah semuanya ✅`;
  });
  document.querySelectorAll("#uploadInfo [data-repackcount]").forEach((s) => {
    if (s.dataset.repackcount === ap) s.textContent = `${done}/${items.length} diterjemahkan`;
  });
}

/** Kemas ulang .pfs: ganti entri yang sudah diterjemahkan, unduh arsip baru. */
async function repackArchive(archivePath) {
  const arch = extractedArchives.get(archivePath);
  if (!arch || arch.kind !== "pfs") { toast("Kemas ulang baru didukung untuk arsip .pfs.", true); return; }
  const replacements = new Map();
  const prefix = archivePath + "/";
  for (const [path, bytes] of translatedOutputs) {
    if (path.startsWith(prefix)) replacements.set(path.slice(prefix.length), bytes);
  }
  if (!replacements.size) { toast("Belum ada file terjemahan dari arsip ini.", true); return; }
  toast("Mengemas ulang arsip...");
  try {
    const buf = await arch.file.arrayBuffer();
    const mod = await import(withVer("./parsers/pfs.js"));
    if (typeof mod.rebuildPfs !== "function") {
      toast("Modul kemas-ulang basi di cache — muat ulang halaman (Ctrl+Shift+R) lalu coba lagi.", true, 6000);
      return;
    }
    const { rebuildPfs, openPfs } = mod;
    const out = await rebuildPfs(buf, replacements);
    // verifikasi: arsip hasil rebuild harus terbaca & entri pengganti ukurannya pas
    const check = await openPfs(out);
    const orig = await openPfs(buf);
    if (check.entries.length !== orig.entries.length) throw new Error("jumlah entri berubah — rebuild dibatalkan");
    for (const [name, bytes] of replacements) {
      const ce = check.entries.find((e) => e.name === name);
      if (!ce || ce.size !== bytes.length) throw new Error(`verifikasi gagal untuk "${name}"`);
    }
    const base = archivePath.split("/").pop();
    const blob = new Blob([out], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = base;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`📦 ${base} dikemas ulang (${replacements.size} file diganti) ✅ — timpa file ini ke folder game.`, false, 6000);
  } catch (e) {
    console.error(e);
    toast("Gagal mengemas ulang: " + e.message, true, 6000);
  }
}

async function extractOnePfs(r) {
  const buf = await r.file.arrayBuffer();
  const { openPfsArchive, listPfsScripts } = await import(withVer("./extract.js"));
  const pfs = await openPfsArchive(buf);
  extractedArchives.set(r.path, { file: r.file, kind: "pfs" });
  const items = listPfsScripts(pfs);
  if (!items.length) throw new Error("tidak ada script .ast/.txt di dalamnya");
  const rows = [];
  let skipped = 0;
  for (const it of items) {
    try {
      const data = pfs.getData(it.index);
      const { text, encoding } = await decodeBuffer(data.buffer);
      if (!text || !text.trim()) { skipped++; continue; }
      const vpath = `${r.path}/${it.name}`;
      const { engine } = detectEngine(vpath, text);
      if (!engine) { skipped++; continue; }
      try {
        const { segments } = engine.parse(text, vpath);
        if (!segments || !segments.length) { skipped++; continue; }
      } catch { skipped++; continue; }
      const vr = makeVirtualRow(vpath, text, engine.id, encoding);
      vr.archivePath = r.path;
      rows.push(vr);
    } catch { skipped++; }
  }
  return { rows, skipped, total: items.length };
}

async function extractPfsRow(idx, btn) {
  const r = pfsRows[idx];
  if (!r || extracting) return;
  extracting = true;
  const old = btn.textContent; btn.disabled = true; btn.textContent = "Ekstrak…";
  try {
    const { rows, skipped, total } = await extractOnePfs(r);
    virtualRows.push(...rows);
    pfsRows.splice(idx, 1);
    rerenderFolderResults();
    toast(`Ekstrak selesai: ${rows.length}/${total} script masuk daftar${skipped ? `, ${skipped} dilewati` : ""} ✅`, false, 3500);
  } catch (e) {
    toast(`Gagal ekstrak ${r.path}: ${e.message}`, true, 5000);
    btn.disabled = false; btn.textContent = old;
  } finally {
    extracting = false;
  }
}

async function extractAllPfs(btn) {
  if (extracting || !pfsRows.length) return;
  extracting = true;
  btn.disabled = true;
  const n = pfsRows.length;
  let done = 0, fail = 0;
  while (pfsRows.length) {
    btn.textContent = `Ekstrak… ${done + 1}/${n}`;
    try {
      const { rows } = await extractOnePfs(pfsRows[0]);
      virtualRows.push(...rows);
      done++;
    } catch { fail++; }
    pfsRows.shift();
  }
  extracting = false;
  rerenderFolderResults();
  toast(`Ekstrak selesai: ${done} arsip${fail ? `, ${fail} gagal` : ""}.`, fail > 0, 4000);
}

/* ---------- terjemahan otomatis batch: semua file 1 grup -> 1 ZIP ----------
 * 278 file tidak muat di localStorage (batas 30 proyek & ±5MB), jadi hasil
 * batch langsung diunduh sebagai ZIP berisi file-file terjemahan. */
let batchRunning = false, batchCancel = false;
// Path file yang sudah selesai diterjemahkan via batch (sesi ini).
// Dipakai untuk ceklis hijau & agar batch berikutnya tidak mengulang (hemat kuota).
const batchDone = new Set();
// Path file yang terjemahannya sudah dipoles (sesi ini) -> "Poles semua" melewatinya.
const polishedDone = new Set();
let polishRunning = false, polishCancel = false;

/* ---------- cache hasil terjemahan (IndexedDB, 24 jam) ---------- */
// Hash cepat (FNV-1a) untuk memastikan isi file tidak berubah sejak diterjemahkan.
function fnv1a(u8) {
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
// Simpan hasil terjemahan 1 file (dipanggil setiap kali ada hasil baru).
// Fire-and-forget: kegagalan cache tidak boleh mengganggu alur utama.
function persistTranslation(row, segments, bytes) {
  (async () => {
    try {
      if (!row || !row.path || !row.file) return;
      const buf = await row.file.arrayBuffer();
      const u8 = new Uint8Array(buf);
      await tcachePut({
        path: row.path,
        engineId: row.engine.id,
        encoding: row.encoding || null,
        size: row.file.size,
        hash: fnv1a(u8),
        bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        segments: segments.map((s) => ({ ...s })),
        polished: polishedDone.has(row.path),
        savedAt: Date.now(),
      });
    } catch (e) { console.warn("cache terjemahan gagal disimpan:", e); }
  })();
}
// Pulihkan hasil terjemahan sesi sebelumnya (maks. 24 jam) untuk baris-baris
// yang tampil. Dipanggil fire-and-forget di akhir renderFolderResults.
async function restoreCacheForRows() {
  let n = 0;
  for (const row of folderRows) {
    if (!row || row.archive || !row.path || !row.file) continue;
    if (batchDone.has(row.path)) continue; // sudah dikerjakan sesi ini
    let entry = null;
    try { entry = await tcacheGet(row.path); } catch { continue; }
    if (!entry) continue;
    if (Date.now() - (entry.savedAt || 0) > TCACHE_TTL) {
      tcacheDel(row.path).catch(() => {});
      continue;
    }
    if (entry.size !== row.file.size) continue; // ukuran berubah -> isi pasti beda
    let same = false;
    try {
      const buf = await row.file.arrayBuffer();
      same = fnv1a(new Uint8Array(buf)) === entry.hash;
    } catch { continue; }
    if (!same) continue; // isi file berubah -> cache tidak berlaku
    translatedOutputs.set(row.path, entry.bytes);
    translatedSegments.set(row.path, entry.segments);
    batchDone.add(row.path);
    if (entry.polished) polishedDone.add(row.path);
    const mark = document.querySelector(`#uploadInfo [data-fdone="${CSS.escape(row.path)}"]`);
    if (mark) mark.textContent = "✅";
    refreshRepackButtons(row.archivePath);
    n++;
  }
  if (n > 0) toast(`💾 ${n} terjemahan dipulihkan dari cache (24 jam) — tanpa memakai kuota API.`, false, 4500);
  return n;
}
// Bersihkan entri basi sekali saat aplikasi dibuka.
tcacheCleanup().catch(() => {});

function batchMtArgs() {
  return {
    providerId: settings.providerId,
    apiKey: keys[settings.providerId] || "",
    endpoint: settings.libreEndpoint,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    glossary: [],
    model: GEMINI_MODEL_ALIAS[settings.geminiModel] || settings.geminiModel || "gemini-3.5-flash",
    onModelFallback: (from, to) => toast(`Model ${from} sibuk — dialihkan otomatis ke ${to}.`, false, 3500),
  };
}

/* Pil progres mengambang: selalu terlihat saat batch terjemahan/poles berjalan,
 * menampilkan angka N/M tanpa harus scroll ke atas. Klik = lompat ke kartu progres. */
function floatProg(main, sub, targetId, onCancel) {
  let el = document.getElementById("floatProg");
  if (!el) {
    el = document.createElement("div");
    el.id = "floatProg";
    el.style.display = "none";
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-fcancel]")) { if (el._onCancel) el._onCancel(); return; }
      const t = document.getElementById(el.dataset.target || "");
      if (t) t.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    document.body.appendChild(el);
  }
  el._onCancel = onCancel || null;
  el.dataset.target = targetId || "";
  el.innerHTML = `<span>${escHtml(main)}</span>` +
    (sub ? `<small>${escHtml(sub)}</small>` : "") +
    (onCancel ? `<button data-fcancel type="button">Batal</button>` : "");
  el.style.display = "";
}
function hideFloatProg() {
  const el = document.getElementById("floatProg");
  if (el) el.style.display = "none";
}

/* Tentukan mesin untuk poles: pakai provider terjemahan yang dipilih bila bisa
 * memoles (Gemini/Claude/Groq/DeepSeek/OpenAI); kalau tidak (DeepL/MyMemory/Libre),
 * pakai Gemini bila key-nya ada, lalu provider lain mana pun yang punya key. */
function resolvePolishProvider() {
  const cur = getProvider(settings.providerId);
  const curKey = cur ? (keys[cur.id] || "").trim() : "";
  if (cur && (cur.id === "gemini" || cur.oai || cur.claude) && curKey) {
    return { id: cur.id, name: cur.name, oai: cur.oai || null, claude: cur.claude || null, apiKey: curKey };
  }
  const gk = (keys.gemini || "").trim();
  if (gk) return { id: "gemini", name: getProvider("gemini").name, oai: null, claude: null, apiKey: gk };
  const anyOther = MT_PROVIDERS.find((p) => (p.oai || p.claude) && (keys[p.id] || "").trim());
  if (anyOther) return { id: anyOther.id, name: anyOther.name, oai: anyOther.oai || null, claude: anyOther.claude || null, apiKey: keys[anyOther.id].trim() };
  return null;
}
function polishGap(pp) {
  if (pp.oai) return (pp.oai.gapMs || 2000) / 1000;
  if (pp.claude) return (pp.claude.gapMs || 2000) / 1000;
  return /pro/i.test(settings.geminiModel || "") ? 15 : 5;
}

async function batchTranslateGroup(engineId, engineName) {
  const items = folderRows.filter((r) => !r.archive && r.engine.id === engineId);
  if (!items.length || batchRunning) return;
  // Lewati file yang sudah selesai di batch sebelumnya (hemat kuota)
  const queue = items.filter((r) => !batchDone.has(r.path));
  const nSkipped = items.length - queue.length;
  if (!queue.length) { toast("Semua file sudah diterjemahkan ✅", false, 3000); return; }
  const prov = getProvider(settings.providerId);
  if (prov.needsKey && !(keys[settings.providerId] || "").trim()) {
    toast(`Isi dulu API key ${prov.name} di tab Pengaturan.`, true, 4000); return;
  }
  const needZip = queue.some((r) => !r.archivePath);
  if (needZip && typeof JSZip === "undefined") { toast("Pustaka ZIP belum termuat — muat ulang halaman.", true); return; }

  // Pra-hitung baris (tanpa API) untuk estimasi jujur
  toast("Menghitung baris...");
  const counts = [];
  let totalSegs = 0;
  for (const row of queue) {
    try {
      const buf = await row.file.arrayBuffer();
      const { text } = await decodeBuffer(buf);
      const { segments } = row.engine.parse(text, row.path);
      const n = segments.filter((s) => s.source && s.source.trim()).length;
      counts.push(n); totalSegs += n;
    } catch { counts.push(0); }
  }
  const nFiles = counts.filter((n) => n > 0).length;
  if (!totalSegs) { toast("Tidak ada baris untuk diterjemahkan.", true); return; }
  const isGem = settings.providerId === "gemini";
  const oaiCfg = getProvider(settings.providerId)?.oai;
  const claudeCfg = getProvider(settings.providerId)?.claude;
  const perReq = isGem ? 15 : settings.providerId === "deepl" ? 40 : (oaiCfg || claudeCfg) ? 15 : 1;
  const gap = isGem ? (/pro/i.test(settings.geminiModel || "") ? 15 : 5)
    : settings.providerId === "mymemory" ? 0.6
    : oaiCfg ? (oaiCfg.gapMs || 2000) / 1000
    : claudeCfg ? (claudeCfg.gapMs || 2000) / 1000 : 0.3;
  const estMin = Math.max(1, Math.round(Math.ceil(totalSegs / perReq) * gap / 60));
  if (!confirm(
    `Terjemahkan otomatis ${nFiles} file (${totalSegs} baris) pakai ${prov.name}?` +
    (nSkipped ? `\n${nSkipped} file sudah selesai sebelumnya — dilewati (hemat kuota).` : "") + `\n\n` +
    `Estimasi ±${estMin} menit (tergantung limit harian penyedia).\n` +
    `File dikerjakan satu per satu — progres ✅ terlihat per baris, dan\n` +
    `kalau kena limit akan berhenti tepat di file itu.\n` +
    `File dari arsip tersimpan untuk kemas ulang (tidak diunduh satu-satu);` +
    (needZip ? `\nfile lepas digabung dalam 1 ZIP di akhir.` : "")
  )) return;

  batchRunning = true; batchCancel = false;
  document.querySelectorAll("#uploadInfo [data-batch]").forEach((b) => { b.disabled = true; });
  const top = document.querySelector("#uploadInfo .notice");
  if (top) top.insertAdjacentHTML("afterend",
    `<div class="card" id="batchProg" style="margin-top:10px">
       <strong>⚡ Menerjemahkan otomatis (${escHtml(engineName)})</strong>
       <div class="muted" id="batchProgText" style="margin-top:4px">Menyiapkan...</div>
       <div style="margin-top:8px"><button class="btn danger" id="btnBatchCancel">Batal</button></div>
     </div>`);
  const setProg = (t) => { const el = document.getElementById("batchProgText"); if (el) el.textContent = t; };
  const doCancel = () => { batchCancel = true; setProg("Membatalkan setelah file ini..."); };
  const cancelBtn = document.getElementById("btnBatchCancel");
  if (cancelBtn) cancelBtn.onclick = doCancel;
  floatProg("⚡ Menyiapkan…", "", "batchProg", doCancel);

  // Kerjakan seperti menekan tombol "Terjemahkan" tiap baris satu per satu,
  // supaya progres ✅ terlihat per file dan berhenti tepat di file yang kena limit.
  const zip = new JSZip();
  let doneFiles = 0, failMsg = "", nZip = 0;
  for (let i = 0; i < queue.length; i++) {
    if (batchCancel) break;
    const row = queue[i];
    if (!counts[i]) continue; // file kosong — lewati tanpa panggil API
    const idx = folderRows.indexOf(row);
    const btn = idx >= 0 ? document.querySelector(`#uploadInfo [data-mtrow="${idx}"]`) : null;
    if (btn) { const fr = btn.closest(".filerow"); if (fr) fr.scrollIntoView({ block: "nearest" }); }
    setProg(`File ${i + 1}/${queue.length}: ${row.path} — menerjemahkan…`);
    floatProg(`⚡ ${i + 1}/${queue.length}`, row.path, "batchProg", doCancel);
    const ok = await translateSingleFile(idx, btn, { fromBatch: true });
    if (!ok) { failMsg = `Berhenti di file ${i + 1}/${queue.length} (${row.path}) — periksa pesan error di atas.`; break; }
    doneFiles++;
    if (!row.archivePath) {
      // file lepas: kumpulkan ke ZIP akhir (bukan diunduh satu-satu)
      const bytes = translatedOutputs.get(row.path);
      if (bytes) { zip.file(row.path, bytes); nZip++; }
    }
    setProg(`File ${i + 1}/${queue.length}: ${row.path} — ✅`);
    floatProg(`⚡ ${i + 1}/${queue.length} ✅`, row.path, "batchProg", doCancel);
  }

  const partial = batchCancel || !!failMsg;
  for (const ap of new Set(queue.map((r) => r.archivePath).filter(Boolean))) refreshRepackButtons(ap);
  if (nZip > 0) {
    setProg("Menyusun ZIP...");
    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `terjemahan-${engineId}${partial ? "-parsial" : ""}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (e) {
      failMsg += ` (gagal membuat ZIP: ${e.message})`;
    }
  }
  const el = document.getElementById("batchProg");
  if (el) el.innerHTML =
    `<strong>⚡ ${partial ? "Dihentikan" : "Selesai"}</strong><br><span class="muted">` +
    `${doneFiles} file selesai ✅` +
    (nZip ? ` — ${nZip} file lepas dalam ZIP.` : ".") +
    (nSkipped ? `<br>${nSkipped} file dilewati (sudah selesai sebelumnya).` : "") +
    (failMsg ? `<br>${escHtml(failMsg)}` : "") +
    (batchCancel ? "<br>Dibatalkan pengguna." : "") + `</span>`;
  hideFloatProg();
  document.querySelectorAll("#uploadInfo [data-batch]").forEach((b) => { b.disabled = false; });
  batchRunning = false;
  toast(doneFiles ? `Selesai: ${doneFiles} file${partial ? " (berhenti di tengah)" : ""}.` : "Tidak ada file yang selesai.", !doneFiles, 4000);
}

/* ✨ Poles semua file se-engine satu per satu (mirip batch terjemahan):
 * hanya file yang sudah diterjemahkan & belum dipoles. Selalu pakai Gemini. */
async function batchPolishGroup(engineId, engineName) {
  const items = folderRows.filter((r) => !r.archive && r.engine.id === engineId);
  if (!items.length || polishRunning) return;
  const pp = resolvePolishProvider();
  if (!pp) { toast("Butuh API key di tab Pengaturan untuk poles kalimat (Gemini/Claude/Groq/DeepSeek/OpenAI).", true, 4500); return; }
  const queue = [];
  let nNoTrans = 0, nSkipped = 0;
  for (const r of items) {
    const segs = translatedSegments.get(r.path);
    const n = segs ? segs.filter((s) => s.translation && s.translation.trim()).length : 0;
    if (!n) { nNoTrans++; continue; }
    if (polishedDone.has(r.path)) { nSkipped++; continue; }
    queue.push({ row: r, segs, n });
  }
  if (!queue.length) {
    toast(nSkipped ? "Semua file sudah dipoles ✨" : "Belum ada file yang diterjemahkan — terjemahkan dulu.", false, 3000);
    return;
  }
  const totalSegs = queue.reduce((a, q) => a + q.n, 0);
  const gap = polishGap(pp);
  const estMin = Math.max(1, Math.round(Math.ceil(totalSegs / 15) * gap / 60));
  if (!confirm(
    `Poles ${queue.length} file (${totalSegs} kalimat) dengan ${pp.name}?\n\n` +
    `Tata bahasa, typo & kefasihan diperbaiki — makna, nama tokoh, dan\n` +
    `penanda [ph id=N] dijaga. Terjemahan yang sudah ada akan DITIMPA.\n` +
    (nSkipped ? `${nSkipped} file sudah dipoles sebelumnya — dilewati.\n` : "") +
    (nNoTrans ? `${nNoTrans} file belum diterjemahkan — dilewati.\n` : "") +
    `\nEstimasi ±${estMin} menit. File dikerjakan satu per satu.`
  )) return;

  polishRunning = true; polishCancel = false;
  document.querySelectorAll("#uploadInfo [data-polish]").forEach((b) => { b.disabled = true; });
  const top = document.querySelector("#uploadInfo .notice");
  if (top) top.insertAdjacentHTML("afterend",
    `<div class="card" id="polishProg" style="margin-top:10px">
       <strong>✨ Memoles kalimat (${escHtml(engineName)})</strong>
       <div class="muted" id="polishProgText" style="margin-top:4px">Menyiapkan...</div>
       <div style="margin-top:8px"><button class="btn danger" id="btnPolishCancel">Batal</button></div>
     </div>`);
  const setProg = (t) => { const el = document.getElementById("polishProgText"); if (el) el.textContent = t; };
  const doCancelP = () => { polishCancel = true; setProg("Membatalkan setelah file ini..."); };
  const cancelBtn = document.getElementById("btnPolishCancel");
  if (cancelBtn) cancelBtn.onclick = doCancelP;
  floatProg("✨ Menyiapkan…", "", "polishProg", doCancelP);

  const model = GEMINI_MODEL_ALIAS[settings.geminiModel] || settings.geminiModel || "gemini-3.5-flash";
  let doneFiles = 0, doneSegs = 0, failMsg = "";
  for (let i = 0; i < queue.length; i++) {
    if (polishCancel) break;
    const { row, segs } = queue[i];
    const idx = folderRows.indexOf(row);
    const btn = idx >= 0 ? document.querySelector(`#uploadInfo [data-mtrow="${idx}"]`) : null;
    if (btn) { const fr = btn.closest(".filerow"); if (fr) fr.scrollIntoView({ block: "nearest" }); }
    setProg(`File ${i + 1}/${queue.length}: ${row.path} — memoles…`);
    floatProg(`✨ ${i + 1}/${queue.length}`, row.path, "polishProg", doCancelP);
    try {
      const targets = segs.filter((s) => s.translation && s.translation.trim());
      const out = await proofreadBatch({
        providerId: pp.id,
        oai: pp.oai,
        apiKey: pp.apiKey,
        model,
        targetLang: settings.targetLang,
        texts: targets.map((s) => s.translation),
        onProgress: (d, t) => {
          setProg(`File ${i + 1}/${queue.length}: ${row.path} — ${d}/${t} kalimat`);
          floatProg(`✨ ${i + 1}/${queue.length}`, `${d}/${t} kalimat`, "polishProg", doCancelP);
        },
        onWait: (s) => setProg(`⏳ Limit — jeda ${s} dtk, lanjut otomatis…`),
        onModelFallback: (from, to) => toast(`Model ${from} sibuk — dialihkan otomatis ke ${to}.`, false, 3500),
      });
      targets.forEach((s, k) => { s.translation = out[k]; });
      // tulis ulang hasil akhir agar ikut kemas ulang
      const buf = await row.file.arrayBuffer();
      const { text, encoding } = await decodeBuffer(buf);
      const applied = row.engine.apply(text, segs);
      const { bytes } = encodeForDownload(applied, row.encoding || encoding);
      translatedOutputs.set(row.path, bytes);
      translatedSegments.set(row.path, segs.map((s) => ({ ...s })));
      polishedDone.add(row.path);
      persistTranslation(row, segs, bytes); // simpan ke cache 24 jam
      doneFiles++; doneSegs += targets.length;
      setProg(`File ${i + 1}/${queue.length}: ${row.path} — ✨`);
      floatProg(`✨ ${i + 1}/${queue.length} ✨`, row.path, "polishProg", doCancelP);
    } catch (e) {
      failMsg = `Berhenti di file ${i + 1}/${queue.length} (${row.path}): ${e.message}`;
      break;
    }
  }

  const partial = polishCancel || !!failMsg;
  for (const ap of new Set(queue.map((q) => q.row.archivePath).filter(Boolean))) refreshRepackButtons(ap);
  const el = document.getElementById("polishProg");
  if (el) el.innerHTML =
    `<strong>✨ ${partial ? "Dihentikan" : "Selesai"}</strong><br><span class="muted">` +
    `${doneFiles} file (${doneSegs} kalimat) dipoles.` +
    (nSkipped ? `<br>${nSkipped} file dilewati (sudah dipoles sebelumnya).` : "") +
    (nNoTrans ? `<br>${nNoTrans} file dilewati (belum diterjemahkan).` : "") +
    (failMsg ? `<br>${escHtml(failMsg)}` : "") +
    (polishCancel ? "<br>Dibatalkan pengguna." : "") + `</span>`;
  hideFloatProg();
  document.querySelectorAll("#uploadInfo [data-polish]").forEach((b) => { b.disabled = false; });
  polishRunning = false;
  toast(doneFiles ? `Selesai: ${doneFiles} file dipoles ✨${partial ? " (berhenti di tengah)" : ""} — periksa sebelum kemas ulang.` : "Tidak ada file yang dipoles.", !doneFiles, 4000);
}

async function handleFile(file) {
  const lower = file.name.toLowerCase();
  const isYpf = lower.endsWith(".ypf");
  const isXp3 = lower.endsWith(".xp3");
  const isRpa = lower.endsWith(".rpa");
  const isPfs = lower.endsWith(".pfs");
  const isArchive = isYpf || isXp3 || isRpa || isPfs;
  const maxSize = isArchive ? 1536 * 1024 * 1024 : 8 * 1024 * 1024;
  if (file.size > maxSize) { toast(`File terlalu besar (maks ${isArchive ? "1,5 GB" : "8 MB"}).`, true); return; }
  if (isArchive && file.size > 512 * 1024 * 1024) {
    toast("File di atas 512 MB — pakai PC/laptop dengan RAM lega, dan prosesnya bisa agak lama.", false, 5000);
  }
  toast("Membaca file...");
  const buf = await file.arrayBuffer();

  // Arsip (YU-RIS .ypf / Kirikiri .xp3): buka penjelajah arsip
  if (isArchive) {
    try {
      await openArchive(file.name, buf, isYpf ? "ypf" : "xp3");
    } catch (e) {
      const m = String(e.message || e);
      if (m.startsWith("ENCRYPTED::")) {
        const entryName = m.slice("ENCRYPTED::".length);
        pendingXp3 = { fileName: file.name, buf };
        $("uploadInfo").innerHTML =
          `<div class="notice">
            <strong>Arsip ini terenkripsi</strong> (contoh: <span class="kbd">${escHtml(entryName)}</span>).<br><br>
            Enkripsi XP3 itu <strong>kunci per game</strong> — tiap game pakai kunci berbeda, jadi tidak ada
            kunci universal. Tapi banyak game doujin memakai skema <em>sederhana</em> (XOR 1 byte)
            yang bisa ditebak otomatis langsung di web.<br><br>
            <button class="btn primary" id="btnXp3Lab">🔓 Coba dekripsi otomatis</button>
            <span class="muted" style="font-size:12px">tanpa install apa pun — jalan di browser</span>
            <br><span class="muted" style="font-size:12px">💡 Punya file .exe gamenya? Klik tombol di atas — lab bisa memindai kunci langsung dari .exe.</span>
            <div id="xp3LabOut" style="margin-top:10px"></div>
            <details style="margin-top:10px">
              <summary class="muted" style="cursor:pointer;font-size:13px">Cara lain kalau dekripsi otomatis gagal</summary>
              <ol style="margin:8px 0;padding-left:20px;line-height:1.8;font-size:13px">
                <li><strong>Kasih tahu saya judul game-nya</strong> — saya carikan skema kuncinya dan
                  tambahkan dukungan khusus ke web.</li>
                <li><strong>Ekstrak sekali di PC</strong> pakai
                  <a href="https://github.com/crskycode/GARbro" target="_blank" rel="noopener">GARbro</a>
                  / KrkrExtract — lalu file <span class="kbd">.ks</span>-nya diterjemahkan di web seperti biasa.</li>
              </ol>
            </details>
          </div>`;
        $("btnXp3Lab").onclick = runXp3Lab;
      } else {
        $("uploadInfo").innerHTML =
          `<div class="notice">Gagal membuka arsip: <strong>${escHtml(m)}</strong></div>`;
      }
    }
    return;
  }

  // Arsip .rpa (Ren'Py) / .pfs (Artemis): ekstrak langsung di browser
  if (isRpa || isPfs) {
    try {
      toast(`Mengekstrak ${file.name}...`);
      const buf = await file.arrayBuffer();
      const { listRpaScripts, readRpaScript, openPfsArchive, listPfsScripts } = await import(withVer("./extract.js"));
      const rows = [];
      let skipped = 0;
      if (isRpa) {
        const items = await listRpaScripts(buf);
        for (const it of items) {
          try {
            const { text } = await readRpaScript(it);
            if (!text || !text.trim()) { skipped++; continue; }
            const vpath = `${file.name}/${it.path}`;
            rows.push(makeVirtualRow(it.path.toLowerCase().endsWith(".rpyc") ? vpath.replace(/\.rpyc$/i, ".rpy") : vpath, text, "renpy"));
          } catch { skipped++; }
        }
      } else {
        const pfs = await openPfsArchive(buf);
        for (const it of listPfsScripts(pfs)) {
          try {
            const data = pfs.getData(it.index);
            const { text } = await decodeBuffer(data.buffer);
            if (!text || !text.trim()) { skipped++; continue; }
            const vpath = `${file.name}/${it.name}`;
            const { engine } = detectEngine(vpath, text);
            if (!engine) { skipped++; continue; }
            try {
              const { segments } = engine.parse(text, vpath);
              if (!segments || !segments.length) { skipped++; continue; }
            } catch { skipped++; continue; }
            rows.push(makeVirtualRow(vpath, text, engine.id));
          } catch { skipped++; }
        }
      }
      if (!rows.length) {
        $("uploadInfo").innerHTML = `<div class="notice">Tidak ada script yang bisa diterjemahkan di dalam <strong>${escHtml(file.name)}</strong>.</div>`;
        return;
      }
      virtualRows = rows;
      renderFolderResults(file.name, rows.length + skipped,
        { ok: [], archives: [], rpyc: [], rpa: [], pfs: [], skipped: [] });
      toast(`Ekstrak selesai: ${rows.length} script siap diterjemahkan ✅`, false, 3500);
    } catch (e) {
      $("uploadInfo").innerHTML =
        `<div class="notice">Gagal mengekstrak <strong>${escHtml(file.name)}</strong>: ${escHtml(e.message)}</div>`;
    }
    return;
  }

  // File .ybn lepas: arahkan ke alur arsip (butuh ysc.ybn dari .ypf yang sama)
  if (file.name.toLowerCase().endsWith(".ybn")) {
    $("uploadInfo").innerHTML =
      `<div class="notice blue">File <strong>${escHtml(file.name)}</strong> adalah script YU-RIS yang butuh
       <span class="kbd">ysc.ybn</span> dari game yang sama untuk dibaca.<br>
       Upload file <strong>.ypf</strong> game-nya, lalu pilih file .ybn dari penjelajah arsip.</div>`;
    return;
  }

  const dec = await (async () => {
    // File .rpyc: decompile dulu di browser, lalu perlakukan sebagai .rpy
    if (lower.endsWith(".rpyc")) {
      toast("Mendecompile .rpyc...");
      try {
        const dt = await decompileRpycBuffer(buf);
        toast("Decompile selesai.", false, 2500);
        return { text: dt, encoding: "utf-8", effName: file.name.replace(/\.rpyc$/i, ".rpy"), decompiled: true };
      } catch (e) {
        $("uploadInfo").innerHTML =
          `<div class="notice">Gagal mendecompile <strong>${escHtml(file.name)}</strong>: ${escHtml(e.message)}<br><br>` +
          `Alternatif: decompile di PC dengan <span class="kbd">unrpyc</span> Python, lalu upload hasil <span class="kbd">.rpy</span>-nya.</div>`;
        return null;
      }
    }
    const d = await decodeBuffer(buf);
    return { text: d.text, encoding: d.encoding, effName: file.name };
  })();
  if (!dec) return;
  const { text, encoding, effName } = dec;
  const { engine, candidates } = detectEngine(effName, text);

  if (!engine) {
    $("uploadInfo").innerHTML =
      `<div class="notice">Format <strong>${escHtml(file.name)}</strong> belum didukung. ` +
      `Lihat tab <strong>Daftar Engine</strong> untuk status dukungan.</div>`;
    return;
  }

  // Tawarkan pilihan engine jika ambigu (mis. .txt)
  let engineChoices = "";
  if (candidates.length > 1) {
    engineChoices = `<label style="font-size:13px">Engine:
      <select id="pickEngine">${candidates.map((c) =>
        `<option value="${c.id}"${c.id === engine.id ? " selected" : ""}>${escHtml(c.name)}</option>`).join("")}
      </select></label> `;
  }

  $("uploadInfo").innerHTML = `
    <div class="notice blue">
      File: <strong>${escHtml(effName)}</strong>${dec.decompiled ? ` <span class="muted">(didecompile dari ${escHtml(file.name)})</span>` : ""} (${(file.size / 1024).toFixed(1)} KB) ·
      Encoding terdeteksi: <strong>${escHtml(encoding)}</strong> ·
      Engine: <strong>${escHtml(engine.name)}</strong> ${engineChoices}
      <div style="margin-top:8px"><button class="btn primary" id="btnStart">Mulai Menerjemahkan →</button></div>
    </div>`;
  $("btnStart").addEventListener("click", () => {
    const sel = $("pickEngine");
    const eng = sel ? getEngine(sel.value) : engine;
    startProject(effName, text, encoding, eng);
  });
}

/* ---------- penjelajah arsip YPF (YU-RIS) ---------- */
let archive = null; // { fileName, kind, version, files, buffer, dialogCounts, decrypted }
let pendingXp3 = null; // { fileName, buf } arsip XP3 terenkripsi yang menunggu lab dekripsi
let xp3LabFound = []; // kandidat hasil crack lab (dirujuk tombol "Pakai & buka arsip")
let archiveTranslated = new Map(); // nama entri -> Uint8Array hasil terjemahan (untuk kemas ulang)
let archiveDone = new Set(); // nama entri yang sudah diterjemahkan ✅

async function openArchive(fileName, buf, kind, opts = {}) {
  toast("Mengekstrak arsip...");
  const parsed = kind === "ypf" ? await parseYpf(buf) : await parseXp3(buf, opts);
  archive = { fileName, kind, version: parsed.version ?? null, files: parsed.files, buffer: buf, dialogCounts: null, decrypted: !!opts.decrypted };
  archiveTranslated = new Map();
  archiveDone = new Set();
  renderArchive();
  showView("archive");
  toast(`Arsip dibuka: ${parsed.files.length} file${opts.decrypted ? " (hasil dekripsi)" : ""}.`);
}

/* ---------- Lab dekripsi XP3 ---------- */
/* Alur: arsip terenkripsi -> analisis -> brute-force XOR 1 byte pada
 * beberapa file .ks -> user pilih kunci yang benar -> arsip dibuka
 * dengan hook dekripsi, alur terjemahan normal jalan seperti biasa. */
async function runXp3Lab() {
  const out = $("xp3LabOut");
  if (!pendingXp3) { toast("Data arsip tidak tersedia — unggah ulang file .xp3-nya.", true); return; }
  out.innerHTML = `<p class="muted">Memuat lab dekripsi...</p>`;
  let lab;
  try {
    lab = await import(withVer("./parsers/xp3crypto.js"));
  } catch (e) {
    out.innerHTML = `<p class="muted">Gagal memuat modul lab: ${escHtml(String(e.message || e))}</p>`;
    return;
  }
  let info;
  try {
    info = await lab.analyzeEncryptedXp3(pendingXp3.buf);
  } catch (e) {
    out.innerHTML = `<p class="muted">Gagal menganalisis arsip: ${escHtml(String(e.message || e))}</p>`;
    return;
  }
  if (info.encrypted === 0) {
    out.innerHTML = `<p class="muted">Tidak ada entri terenkripsi yang terdeteksi.</p>`;
    return;
  }
  const candList = info.candidates.length
    ? info.candidates.map((c) => `<li><span class="kbd">${escHtml(c.name)}</span> <span class="muted">(${fmtSize(c.packedSize)})</span></li>`).join("")
    : `<li class="muted">tidak ada file .ks terenkripsi — dekripsi otomatis butuh sampel teks (.ks)</li>`;
  // Deteksi Riddle Joker (.scn terkompilasi, XOR 1-byte per file)
  let riddle = null;
  try {
    riddle = await lab.detectRiddleJokerScn(pendingXp3.buf);
  } catch { riddle = null; }
  const riddleHtml = (riddle && riddle.verified > 0)
    ? `<div style="margin:10px 0;padding:10px;border:2px solid #4caf50;border-radius:8px;background:#e8f5e9">
        <strong>🎮 Terdeteksi: Riddle Joker (Yuzusoft)</strong><br>
        <span style="font-size:13px">${riddle.verified} file .scn terverifikasi pola enkripsinya
        (dari ${riddle.count} file .scn). Klik untuk buka arsip — skenario terkompilasi (.scn) akan terdekripsi otomatis.</span><br>
        <button class="btn primary" id="btnRiddleJoker" style="margin-top:8px">🔓 Buka sebagai Riddle Joker</button>
        <button class="btn" id="btnRiddleDump" style="margin-top:8px;margin-left:8px">📝 Dump Text</button>
        <span class="muted" id="riddleProg" style="font-size:12px;margin-left:8px"></span>
        <div id="riddleDumpOut" style="margin-top:10px"></div>
      </div>`
    : "";
  // Inventaris isi arsip: nama file di indeks tidak terenkripsi, jadi selalu bisa dilihat.
  const invRows = (info.files || []).slice(0, 1000).map((f) =>
    `<tr><td style="white-space:nowrap">` + (f.encrypted ? "🔒" : "🔓") + `</td>` +
    `<td><span class="kbd">` + escHtml(f.name) + `</span></td>` +
    `<td style="text-align:right;white-space:nowrap">` + fmtSize(f.packedSize) + `</td></tr>`).join("");
  const invHtml =
    `<details style="margin:8px 0 4px"><summary class="muted" style="cursor:pointer;font-size:13px">` +
    `📋 Daftar isi arsip (` + (info.files || []).length + ` file) — nama file tetap terbaca walau terenkripsi</summary>` +
    `<div style="max-height:320px;overflow:auto;margin-top:6px;border:1px solid #999;border-radius:8px">` +
    `<table style="font-size:12px;width:100%;border-collapse:collapse"><tbody>` + invRows + `</tbody></table></div>` +
    ((info.files || []).length > 1000
      ? `<p class="muted" style="font-size:12px">…dan ` + ((info.files || []).length - 1000) + ` file lain tidak ditampilkan</p>` : "") +
    `</details>`;
  out.innerHTML =
    `<div class="card" style="margin:10px 0;padding:14px">
      <strong>🔬 Lab dekripsi XP3</strong><br>
      ${riddleHtml}
      <span class="muted" style="font-size:13px">${info.encrypted} dari ${info.total} file terenkripsi.
      Lab akan mencoba: ① KAG-scramble (skrip Kirikiri teracak, tanpa kunci),
      ② skema turunan hash & nama file, ③ <em>known-plaintext</em> dari file gambar,
      ④ 255 kunci XOR — pada sampel file .ks/.tjs di bawah. Yang benar menghasilkan teks terbaca.
      ⑤ <strong>Punya file .exe gamenya?</strong> Kunci enkripsi biasanya tersimpan di dalam .exe — pindai otomatis di bawah.</span>
      <ul style="margin:8px 0;padding-left:20px;font-size:13px">${candList}</ul>
      ${invHtml}
      <button class="btn primary" id="btnXp3Crack" ${info.candidates.length ? "" : "disabled"}>🔍 Jalankan analisis</button>
      <span class="muted" id="xp3LabProg" style="font-size:12px;margin-left:8px"></span>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:13px">
        <label class="muted">File .sig pendamping (opsional)
          <input type="file" id="xp3SigFile" accept=".sig" style="display:block;margin-top:4px">
        </label>
        <label class="muted" style="flex:1;min-width:180px">🔑 Kunci manual (hex, mis. 11 22 33)
          <input type="text" id="xp3ManualKey" placeholder="tempel hex kunci dari arsip lain" style="display:block;margin-top:4px;width:100%">
        </label>
        <button class="btn" id="btnXp3Manual" style="align-self:flex-end">Buka arsip dengan kunci manual</button>
      </div>
      <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #999">
        <strong>🎮 Punya file .exe gamenya?</strong><br>
        <span class="muted" style="font-size:12px">Kunci enkripsi XP3 hampir selalu tersimpan sebagai string di dalam .exe
        game (cara GARbro menemukan kunci tiap game juga begitu). Drop .exe-nya di sini — web memindai ribuan
        string di dalamnya dan mencoba tiap string sebagai kunci. Tetap 100% di browser, tanpa install apa pun.</span>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <input type="file" id="xp3ExeFile" accept=".exe">
          <button class="btn" id="btnXp3ExeScan">🔑 Pindai .exe & coba kuncinya</button>
          <span class="muted" id="xp3ExeProg" style="font-size:12px"></span>
        </div>
        <div id="xp3ExeResults"></div>
      </div>
      <div id="xp3LabResults" style="margin-top:10px"></div>
    </div>`;
  // Tombol Riddle Joker (jika terdeteksi)
  if ($("btnRiddleJoker")) {
    $("btnRiddleJoker").onclick = async () => {
      const prog = $("riddleProg");
      try {
        if (prog) prog.textContent = "mendekripsi .scn...";
        const decrypt = lab.makeRiddleJokerScnDecryptor();
        await openArchive(pendingXp3.fileName, pendingXp3.buf, "xp3", { decrypt, decrypted: true });
        toast(`Arsip Riddle Joker dibuka — ${riddle.count} file .scn terdekripsi.`);
      } catch (e) {
        toast(`Gagal membuka sebagai Riddle Joker: ${e.message || e}`, true);
      } finally {
        if (prog) prog.textContent = "";
      }
    };
  }
  // Tombol Dump Text Riddle Joker: dekripsi lapis-1+2 semua .scn, ekstrak dialog
  if ($("btnRiddleDump")) {
    $("btnRiddleDump").onclick = async () => {
      const prog = $("riddleProg");
      const box = $("riddleDumpOut");
      try {
        if (prog) prog.textContent = "mendekripsi & mengekstrak dialog...";
        if (box) box.innerHTML = `<p class="muted" style="font-size:13px">Memproses file .scn...</p>`;
        const decrypt = lab.makeRiddleJokerScnDecryptor();
        const { files } = await parseXp3(pendingXp3.buf, { decrypt });
        const scnFiles = files.filter((f) => f.name.toLowerCase().endsWith(".scn"));
        const sections = [];
        let totalLines = 0, filesWithDlg = 0;
        for (const f of scnFiles) {
          const d2 = lab.applyRiddleJokerLayer2(f.data);
          const dlg = lab.extractRiddleJokerDialogue(d2);
          if (dlg.length > 0) {
            filesWithDlg++;
            totalLines += dlg.length;
            sections.push(`=== ${f.name} (${dlg.length} baris) ===\n` + dlg.join("\n"));
          }
          if (prog) prog.textContent = `mendekripsi & mengekstrak dialog... (${filesWithDlg}/${scnFiles.length} file)`;
        }
        const fullText = sections.join("\n\n");
        if (box) {
          box.innerHTML =
            `<div style="padding:10px;border:2px solid #2196f3;border-radius:8px;background:var(--card,#f5f5f5)">` +
            `<strong>📝 Dump dialog Riddle Joker</strong><br>` +
            `<span class="muted" style="font-size:13px">${scnFiles.length} file .scn diproses · ` +
            `${filesWithDlg} file berisi dialog · ${totalLines} baris dialog.</span><br>` +
            `<div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap">` +
            `<button class="btn primary" id="btnDumpCopy">📋 Salin semua</button>` +
            `<button class="btn" id="btnDumpDl">💾 Unduh .txt</button></div>` +
            `<textarea id="riddleDumpText" readonly style="width:100%;height:320px;font-size:12px;` +
            `font-family:monospace;white-space:pre-wrap;box-sizing:border-box">${escHtml(fullText)}</textarea></div>`;
          $("btnDumpCopy").onclick = async () => {
            try {
              await navigator.clipboard.writeText(fullText);
              toast(`Disalin: ${totalLines} baris dialog.`);
            } catch {
              $("riddleDumpText").select();
              document.execCommand("copy");
              toast("Disalin (fallback).");
            }
          };
          $("btnDumpDl").onclick = () => {
            const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "riddle-joker-dialogue.txt";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            toast("File riddle-joker-dialogue.txt diunduh.");
          };
        }
        toast(`Dump selesai: ${totalLines} baris dialog dari ${filesWithDlg} file.`);
      } catch (e) {
        toast(`Gagal dump text: ${e.message || e}`, true);
        if (box) box.innerHTML = "";
      } finally {
        if (prog) prog.textContent = "";
      }
    };
  }
  $("btnXp3Manual").onclick = async () => {
    const hexEl = $("xp3ManualKey");
    try {
      const kb = lab.parseHexKey(hexEl.value);
      const decrypt = await lab.makeDecryptorForResult(pendingXp3.buf, { scheme: "manual", key: kb });
      await openArchive(pendingXp3.fileName, pendingXp3.buf, "xp3", { decrypt, decrypted: true });
      const nKag = await descrambleKagInArchive(lab);
      toast(`Arsip dibuka dengan kunci manual (${kb.length} byte).` +
        (nKag ? ` ${nKag} file KAG-scramble di-descramble.` : "") + ` File .ks siap diterjemahkan.`);
    } catch (e) {
      toast(`Kunci manual gagal: ${e.message || e}`, true);
    }
  };
  // Helper kartu hasil crack — dipakai tombol crack otomatis & pindai .exe
  const keyLabel = (f) => {
      if (f.scheme === "xor1b") return `Kunci ${lab.keyHex(f.key)}`;
      if (f.scheme === "knownplain") return `Kunci ${f.key.map((x) => x.toString(16).padStart(2, "0")).join(" ")}`;
      return `Skema ${escHtml(f.schemeName)}`;
    };
    const cardHtml = (f, i, fromName) => {
      const idx = xp3LabFound.length;
      xp3LabFound.push(f);
      return `<div class="card" style="margin:8px 0;padding:12px;${i === 0 ? "border-left:4px solid var(--ok)" : ""}">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <strong>${keyLabel(f)}</strong>
          <span class="badge ${i === 0 ? "ok" : "kind"}">skor ${(f.score * 100).toFixed(0)}%${i === 0 ? " — paling meyakinkan" : ""}</span>
          <span class="muted" style="font-size:11px">${escHtml(f.schemeName)}${f.encoding && f.encoding !== "shift-jis" ? " · " + escHtml(f.encoding) : ""}</span>
          <span class="spacer" style="flex:1"></span>
          <button class="btn primary" data-xp3idx="${idx}">✅ Pakai & buka arsip</button>
        </div>
        <pre class="muted" style="font-size:12px;white-space:pre-wrap;word-break:break-word;margin:8px 0 0;max-height:120px;overflow:auto">${escHtml(f.preview)}</pre>
        <div class="muted" style="font-size:11px;margin-top:4px">dari <span class="kbd">${escHtml(fromName)}</span></div>
      </div>`;
    };
    const wireApply = (box) => {
      box.querySelectorAll("[data-xp3idx]").forEach((b) => {
        b.onclick = async () => {
          const f = xp3LabFound[+b.dataset.xp3idx];
          b.disabled = true;
          b.textContent = "Membuka arsip...";
          try {
            const decrypt = await lab.makeDecryptorForResult(pendingXp3.buf, f);
            await openArchive(pendingXp3.fileName, pendingXp3.buf, "xp3", { decrypt, decrypted: true });
            const nKag = await descrambleKagInArchive(lab);
            toast(`Arsip didekripsi (${escHtml(f.schemeName)}).` +
              (nKag ? ` ${nKag} file KAG-scramble di-descramble.` : "") +
              ` File .ks siap diterjemahkan.`);
          } catch (e) {
            b.disabled = false;
            b.textContent = "✅ Pakai & buka arsip";
            toast(`Gagal membuka arsip: ${e.message || e}`, true);
          }
        };
      });
    };

  /* ---------- Pindai kunci dari file .exe game ---------- */
  $("btnXp3ExeScan").onclick = async () => {
    const fileEl = $("xp3ExeFile");
    const f = fileEl && fileEl.files[0];
    const btn = $("btnXp3ExeScan"), prog = $("xp3ExeProg"), box = $("xp3ExeResults");
    if (!f) { toast("Pilih dulu file .exe gamenya.", true); return; }
    btn.disabled = true;
    box.innerHTML = "";
    try {
      if (!info.candidates.length) {
        box.innerHTML = `<p class="muted" style="font-size:13px">Tidak ada file .ks terenkripsi untuk dijadikan sampel.</p>`;
        return;
      }
      prog.textContent = "membaca .exe...";
      const exeBytes = new Uint8Array(await f.arrayBuffer());
      const strings = lab.extractExeStrings(exeBytes);
      if (!strings.length) {
        box.innerHTML = `<p class="muted" style="font-size:13px">Tidak ada string kandidat di file ini — pastikan itu .exe gamenya.</p>`;
        return;
      }
      let merged = [];
      for (const c of info.candidates) {
        const { candidates, results } = await lab.crackExeKeys(
          pendingXp3.buf, c.name, exeBytes,
          { extraCandidates: [f.name, f.name.replace(/\.exe$/i, "")] },
          (p) => { prog.textContent = `mencoba ${candidates} kunci dari .exe... ${Math.round(p * 100)}%`; });
        for (const r of results) merged.push({ r, from: c.name });
        if (merged.some((m) => m.r.score >= 0.95)) break;
      }
      merged.sort((a, b) => b.r.score - a.r.score);
      prog.textContent = "";
      if (!merged.length) {
        box.innerHTML = `<p class="muted" style="font-size:13px">🔑 ${strings.length} string dari .exe sudah dicoba semua — tidak ada yang cocok. ` +
          `Kemungkinan cipher-nya kuat (AES/custom), bukan XOR sederhana. Jalur tersisa: ekstrak sekali di PC ` +
          `pakai KrkrExtract hook, lalu terjemahkan file .ks-nya di web seperti biasa.</p>`;
      } else {
        box.innerHTML = `<p style="font-size:13px;margin:10px 0 4px"><strong>🔑 Kandidat kunci dari .exe</strong></p>` +
          merged.slice(0, 3).map((m, i) => cardHtml(m.r, i, m.from)).join("");
        wireApply(box);
      }
    } catch (e) {
      prog.textContent = "";
      box.innerHTML = `<p class="muted" style="font-size:13px">Gagal memindai .exe: ${escHtml(String(e.message || e))}</p>`;
    } finally {
      btn.disabled = false;
    }
  };

  if (!info.candidates.length) return;
  $("btnXp3Crack").onclick = async () => {
    $("btnXp3Crack").disabled = true;
    const resDiv = $("xp3LabResults");
    resDiv.innerHTML = "";
    xp3LabFound = [];

    // 0) known-plaintext global: bongkar kunci berulang dari file gambar terenkripsi
    {
      const box = document.createElement("div");
      box.innerHTML = `<p class="muted" style="font-size:13px">🔑 Mencoba known-plaintext dari file gambar...</p>`;
      resDiv.appendChild(box);
      try {
        const kp = await lab.crackKnownPlaintext(pendingXp3.buf, info.candidates.map((c) => c.name), (p) => {
          $("xp3LabProg").textContent = `known-plaintext... ${Math.round(p * 100)}%`;
        });
        $("xp3LabProg").textContent = "";
        if (kp.length) {
          box.innerHTML = `<p style="font-size:13px;margin:10px 0 4px"><strong>🔑 Kunci dari known-plaintext</strong>
            <span class="muted">(dibongkar dari magic bytes file gambar — salin hex kuncinya ke kolom "Kunci manual" bila ingin dipakai di file .xp3 lain dari game yang sama)</span></p>` +
            kp.map((f, i) => cardHtml(f, i, f.extra && f.extra.fromImage ? f.extra.fromImage : "gambar")).join("");
          wireApply(box);
        } else {
          box.innerHTML = `<p class="muted" style="font-size:13px">🔑 known-plaintext: tidak ada kunci berulang yang cocok
            (tidak ada file gambar/audio terenkripsi yang bisa dipakai).</p>`;
        }
      } catch (e) {
        box.innerHTML = `<p class="muted" style="font-size:13px">⚠ known-plaintext: ${escHtml(String(e.message || e))}</p>`;
      }
    }
    const sigFile = $("xp3SigFile") && $("xp3SigFile").files[0] ? $("xp3SigFile").files[0] : null;
    const sigBytes = sigFile ? new Uint8Array(await sigFile.arrayBuffer()) : null;
    if (sigBytes) toast(`File .sig dimuat (${sigBytes.length} byte) — dicoba sebagai kunci.`);
    for (const c of info.candidates) {
      const box = document.createElement("div");
      box.innerHTML = `<p class="muted" style="font-size:13px">Menganalisis <span class="kbd">${escHtml(c.name)}</span>...</p>`;
      resDiv.appendChild(box);
      let found = [];
      try {
        found = await lab.crackEntry(pendingXp3.buf, c.name, (p) => {
          $("xp3LabProg").textContent = `mencoba kunci... ${Math.round(p * 100)}%`;
        });
        if (sigBytes) {
          $("xp3LabProg").textContent = `mencoba kunci .sig...`;
          const sf = await lab.crackSigKeys(pendingXp3.buf, c.name, sigBytes);
          found = found.concat(sf);
          found.sort((a, b) => b.score - a.score);
          found = found.slice(0, 3);
        }
      } catch (e) {
        box.innerHTML = `<p class="muted" style="font-size:13px">⚠ <span class="kbd">${escHtml(c.name)}</span>: ${escHtml(String(e.message || e))}</p>`;
        continue;
      }
      $("xp3LabProg").textContent = "";
      let forensicHtml = "";
      try {
        const fs = await lab.forensicSample(pendingXp3.buf, c.name);
        forensicHtml = `<details style="margin:8px 0;font-size:12px">
          <summary class="muted" style="cursor:pointer">🔬 Detail forensik (kirim screenshot ini bila analisis gagal)</summary>
          <div class="card" style="margin-top:6px;padding:10px">
            <div class="muted">ukuran: ${fs.packedSize} B → ${fs.unpackedSize} B · segmen: ${fs.segCount} · terkompresi: ${fs.compressed ? "ya" : "tidak"} · hash: <span class="kbd">${escHtml(fs.hashHex)}</span></div>
            <div class="muted" style="margin-top:4px">entropi: <strong>${escHtml(fs.entropy)}</strong>/8 · index of coincidence: <strong>${escHtml(fs.ic)}</strong></div>
            <div style="margin-top:4px">📊 <strong>${escHtml(fs.verdict)}</strong></div>
            <div class="muted" style="margin-top:6px">48 byte pertama (hex):</div>
            <code style="font-size:11px;word-break:break-all;user-select:all">${escHtml(fs.hex)}</code>
          </div>
        </details>`;
      } catch (e) {
        forensicHtml = `<p class="muted" style="font-size:12px">⚠ forensik: ${escHtml(String(e.message || e))}</p>`;
      }
      if (!found.length) {
        box.innerHTML = `<p class="muted" style="font-size:13px">✖ <span class="kbd">${escHtml(c.name)}</span>: tidak ada skema yang cocok
          (game ini memakai skema yang lebih kompleks / kunci custom).</p>` + forensicHtml;
        continue;
      }
      box.innerHTML = found.map((f, i) => cardHtml(f, i, c.name)).join("") + forensicHtml;
      wireApply(box);
    }
    $("btnXp3Crack").disabled = false;
  };
}

/** Post-step: descramble file .ks/.tjs KAG-scramble (FE FE xx FF FE) hasil ekstraksi. */
async function descrambleKagInArchive(lab) {
  if (!archive || !archive.files) return 0;
  let n = 0;
  for (const f of archive.files) {
    if (!/\.(ks|tjs)$/i.test(f.name)) continue;
    try {
      if (lab.kagScrambleMode(f.data) >= 0) {
        f.data = await lab.descrambleKag(f.data);
        f.size = f.data.length;
        n++;
      }
    } catch { /* bukan scramble valid — lewati */ }
  }
  if (n > 0) renderArchive();
  return n;
}

function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function renderArchive() {
  const has = !!archive;
  $("archiveEmpty").style.display = has ? "none" : "";
  $("archiveMain").style.display = has ? "" : "none";
  if (!has) return;
  const isYpf = archive.kind === "ypf";
  $("arcFileName").textContent = archive.fileName;
  $("arcEngine").textContent = isYpf ? "YU-RIS" : "Kirikiri";
  $("arcVersion").textContent = archive.version ?? "-";
  $("arcCount").textContent = archive.files.length;
  $("arcYpfTools").style.display = isYpf ? "" : "none";
  $("arcXp3Tools").style.display = isYpf ? "none" : "";
  $("arcXp3Hint").style.display = isYpf ? "none" : "";
  if (!isYpf) {
    const ksCount = archive.files.filter((f) => f.name.toLowerCase().endsWith(".ks")).length;
    $("arcXp3Count").textContent = `${ksCount} file .ks`;
  }
  renderArchiveRows($("arcSearch").value || "");
  refreshArchiveRepackButtons();
}

function renderArchiveRows(q) {
  const ql = q.trim().toLowerCase();
  const isYpf = archive.kind === "ypf";
  const rows = archive.files
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !ql || f.name.toLowerCase().includes(ql));
  $("arcBody").innerHTML = rows.map(({ f, i }) => {
    const ln = f.name.toLowerCase();
    let check = "", extraBtn = "", dlgBadge = "";
    const dc = archive.dialogCounts ? archive.dialogCounts.get(f.name) : undefined;
    if (dc !== undefined) {
      dlgBadge = dc >= 0
        ? ` <span class="badge ${dc ? "ok" : "kind"}">${dc ? `💬 ${dc}` : "kosong"}</span>`
        : ` <span class="badge soon">tidak terbaca</span>`;
    }
    if (isYpf) {
      const isYbn = ln.endsWith(".ybn") && !/ysc\.ybn$/.test(ln);
      if (isYbn) check = `<input type="checkbox" class="arcCheck" data-arc="${escHtml(f.name)}">`;
    } else if (ln.endsWith(".ks")) {
      extraBtn = ` <button class="btn primary" data-trks="${i}">🌐 Terjemahkan</button>`;
    }
    const doneMark = archiveDone.has(f.name) ? `<span class="bdone" title="Sudah diterjemahkan">✅</span> ` : "";
    return `<tr>
      <td>${doneMark}${check}</td>
      <td style="word-break:break-all">${escHtml(f.name)}${dlgBadge}</td>
      <td class="muted">${fmtSize(f.size)}</td>
      <td style="white-space:nowrap"><button class="mini" data-prev="${i}" title="Lihat isi teks">👁 Lihat</button> <button class="btn" data-arc="${i}">⬇ Unduh</button>${extraBtn}</td>
    </tr>`;
  }).join("") ||
    `<tr><td colspan="4" class="muted">Tidak ada file yang cocok.</td></tr>`;
  $("arcBody").querySelectorAll("[data-arc]").forEach((b) =>
    b.addEventListener("click", () => downloadArchiveFile(Number(b.dataset.arc))));
  $("arcBody").querySelectorAll("[data-prev]").forEach((b) =>
    b.addEventListener("click", () => previewArchiveFile(Number(b.dataset.prev))));
  $("arcBody").querySelectorAll("[data-trks]").forEach((b) =>
    b.addEventListener("click", () => startKsFromArchive(Number(b.dataset.trks))));
}

/** Mulai proyek Kirikiri langsung dari file .ks di dalam arsip .xp3. */
async function startKsFromArchive(i) {
  const f = archive.files[i];
  if (!f) return;
  const ab = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
  const { text, encoding } = await decodeBuffer(ab);
  const base = f.name.split(/[\\/]/).pop();
  startProject(base, text, encoding, getEngine("kirikiri"));
  if (project) project.archiveEntry = { kind: "xp3", archiveName: archive.fileName, entryName: f.name };
}

/** Pratinjau isi teks sebuah file di dalam arsip — untuk mengecek apakah berisi dialog. */
async function previewArchiveFile(i) {
  const f = archive.files[i];
  if (!f) return;
  const ln = f.name.toLowerCase();
  const base = f.name.split(/[\\/]/).pop();
  $("prevTitle").textContent = `👁 ${base}`;
  $("prevMeta").textContent = "Membaca...";
  $("prevBody").innerHTML = "";
  $("btnPrevTranslate").style.display = "none";
  $("previewModal").classList.add("open");
  let goTranslate = null;
  try {
    let items = [], meta = "";
    if (archive.kind === "ypf" && ln.endsWith(".ybn") && !/ysc\.ybn$/.test(ln)) {
      const yscFile = archive.files.find((x) => x.name.toLowerCase().endsWith("ysc.ybn"));
      if (!yscFile) throw new Error("ysc.ybn tidak ditemukan di arsip ini — pratinjau .ybn butuh file itu.");
      const { special } = parseYsc(yscFile.data);
      const p = parseYstb(f.data, special);
      items = p.words.filter((w) => w.text.trim()).map((w) => ({ speaker: w.speaker || "", text: w.body }));
      meta = `${items.length} string dialog/narasi (WORD) · ${fmtSize(f.size)}`;
      goTranslate = () => { $("previewModal").classList.remove("open"); startYurisProject([f.name]); };
    } else if (archive.kind === "xp3" && ln.endsWith(".ks")) {
      const ab = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
      const { text, encoding } = await decodeBuffer(ab);
      const { segments } = getEngine("kirikiri").parse(text);
      items = segments.map((s) => ({ speaker: "", text: s.source }));
      meta = `${items.length} baris teks · encoding ${encoding} · ${fmtSize(f.size)}`;
      goTranslate = () => { $("previewModal").classList.remove("open"); startKsFromArchive(i); };
    } else {
      throw new Error("Tipe file ini tidak punya teks dialog yang bisa ditampilkan.");
    }
    $("prevMeta").textContent = meta;
    if (!items.length) {
      $("prevBody").innerHTML = `<div class="notice">File ini tidak mengandung teks dialog yang bisa diterjemahkan.</div>`;
    } else {
      const shown = items.slice(0, 30);
      $("prevBody").innerHTML =
        shown.map((s) =>
          `<div class="prev-row">${s.speaker ? `<span class="prev-sp">${escHtml(s.speaker)}</span>` : ""}<span class="prev-tx">${escHtml(s.text)}</span></div>`
        ).join("") +
        (items.length > shown.length ? `<p class="muted">…dan ${items.length - shown.length} baris lagi.</p>` : "");
      if (goTranslate) {
        $("btnPrevTranslate").style.display = "";
        $("btnPrevTranslate").onclick = goTranslate;
      }
    }
  } catch (e) {
    console.error(e);
    $("prevMeta").textContent = "";
    let msg = e.message;
    if (/magic tidak cocok/i.test(msg))
      msg = "File ini bukan script dialog (format tidak dikenali) — kemungkinan file sistem/konfigurasi. Aman dilewati.";
    $("prevBody").innerHTML = `<div class="notice">${escHtml(msg)}</div>`;
  }
}

$("btnClosePrev").addEventListener("click", () => $("previewModal").classList.remove("open"));
$("previewModal").addEventListener("click", (e) => {
  if (e.target === $("previewModal")) $("previewModal").classList.remove("open");
});

/** Pindai semua file script di arsip: hitung dialog per file, tandai yang berisi dialog. */
async function scanArchiveDialogs() {
  if (!archive) return;
  const btn = $("btnArcScan");
  btn.disabled = true;
  btn.textContent = "⏳ Memindai...";
  const counts = new Map(); // nama file -> jumlah dialog, atau -1 bila tidak terbaca
  try {
    if (archive.kind === "ypf") {
      const yscFile = archive.files.find((f) => f.name.toLowerCase().endsWith("ysc.ybn"));
      if (!yscFile) { toast("ysc.ybn tidak ditemukan di arsip ini.", true); return; }
      const { special } = parseYsc(yscFile.data);
      for (const f of archive.files) {
        const ln = f.name.toLowerCase();
        if (!ln.endsWith(".ybn") || /ysc\.ybn$/.test(ln)) continue;
        try {
          const p = parseYstb(f.data, special);
          counts.set(f.name, p.words.filter((w) => w.text.trim()).length);
        } catch (e) {
          console.warn("Pindai lewati " + f.name + ": " + e.message);
          counts.set(f.name, -1);
        }
      }
    } else {
      const kirikiri = getEngine("kirikiri");
      for (const f of archive.files) {
        if (!f.name.toLowerCase().endsWith(".ks")) continue;
        try {
          const ab = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
          const { text } = await decodeBuffer(ab);
          counts.set(f.name, kirikiri.parse(text).segments.length);
        } catch (e) {
          console.warn("Pindai lewati " + f.name + ": " + e.message);
          counts.set(f.name, -1);
        }
      }
    }
    archive.dialogCounts = counts;
    renderArchiveRows($("arcSearch").value || "");
    // otomatis centang file .ybn yang berisi dialog
    document.querySelectorAll(".arcCheck").forEach((c) => {
      c.checked = (counts.get(c.dataset.arc) || 0) > 0;
    });
    const withDialog = [...counts.values()].filter((n) => n > 0).length;
    const unreadable = [...counts.values()].filter((n) => n < 0).length;
    toast(`Pindai selesai: ${withDialog} file berisi dialog${unreadable ? `, ${unreadable} tidak terbaca` : ""}. File berdialog otomatis dicentang.`);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Pindai dialog";
  }
}

$("btnArcScan").addEventListener("click", scanArchiveDialogs);

/** Segarkan tombol kemas ulang di viewer arsip (aktif bila ≥1 file ✅). */
function refreshArchiveRepackButtons() {
  const n = archiveDone.size;
  const by = $("btnArcRepackYpf"), bx = $("btnArcRepackXp3");
  if (by) {
    by.disabled = n === 0;
    by.classList.toggle("primary", n > 0);
    by.textContent = n > 0 ? `📦 Kemas ulang .ypf (${n} file)` : "📦 Kemas ulang .ypf";
    by.title = n > 0 ? "Kemas file .ybn yang sudah diterjemahkan kembali ke arsip" : "Aktif setelah ada file .ybn yang diterjemahkan & diekspor";
  }
  if (bx) {
    if (archive && archive.decrypted) {
      // Arsip dibuka via dekripsi: kemas ulang tanpa enkripsi asli tidak akan dibaca game.
      bx.disabled = true;
      bx.classList.remove("primary");
      bx.textContent = "📦 Kemas ulang .xp3";
      bx.title = "Nonaktif: arsip ini dibuka via dekripsi — unduh file .ks-nya saja, game butuh enkripsi aslinya";
    } else {
      bx.disabled = n === 0;
      bx.classList.toggle("primary", n > 0);
      bx.textContent = n > 0 ? `📦 Kemas ulang .xp3 (${n} file)` : "📦 Kemas ulang .xp3";
      bx.title = n > 0 ? "Kemas file .ks yang sudah diterjemahkan kembali ke arsip" : "Aktif setelah ada file .ks yang diterjemahkan";
    }
  }
}

/** Terjemahkan semua .ks di arsip .xp3 langsung di tempat (tanpa buka editor). */
let arcTranslating = false;
async function translateAllKs() {
  if (!archive || archive.kind !== "xp3" || arcTranslating) return;
  const prov = getProvider(settings.providerId);
  if (prov.needsKey && !(keys[settings.providerId] || "").trim()) {
    toast(`Isi dulu API key ${prov.name} di tab Pengaturan.`, true, 4000); return;
  }
  const kirikiri = getEngine("kirikiri");
  const targets = archive.files.filter((f) =>
    f.name.toLowerCase().endsWith(".ks") && !archiveDone.has(f.name));
  if (!targets.length) { toast("Semua file .ks sudah diterjemahkan ✅", false, 2500); return; }
  // hitung total baris dulu untuk konfirmasi
  const parsed = [];
  for (const f of targets) {
    try {
      const { text, encoding } = await decodeBuffer(f.data);
      const { segments } = kirikiri.parse(text);
      const todo = segments.filter((s) => s.source && s.source.trim());
      if (todo.length) parsed.push({ f, text, encoding, segments, todo });
    } catch (e) { console.warn("Lewati " + f.name + ": " + e.message); }
  }
  const totalSegs = parsed.reduce((a, p) => a + p.todo.length, 0);
  if (!totalSegs) { toast("Tidak ada baris untuk diterjemahkan.", true); return; }
  if (!confirm(`Terjemahkan otomatis ${parsed.length} file .ks (${totalSegs} baris) pakai ${prov.name}?`)) return;
  arcTranslating = true;
  const btn = $("btnArcTranslateKs");
  const oldLabel = btn.textContent;
  btn.disabled = true;
  let doneSegs = 0, doneFiles = 0;
  try {
    for (const p of parsed) {
      btn.textContent = `Menerjemahkan… ${doneFiles + 1}/${parsed.length}`;
      const out = await translateBatch({
        ...batchMtArgs(),
        texts: p.todo.map((s) => s.source),
        onProgress: (d) => { btn.textContent = `Menerjemahkan… ${doneFiles + 1}/${parsed.length} (${doneSegs + d}/${totalSegs} baris)`; },
        onWait: (s) => { btn.textContent = `⏳ Limit — jeda ${s} dtk, lanjut otomatis…`; },
      });
      p.todo.forEach((s, k) => { s.translation = out[k]; });
      const applied = kirikiri.apply(p.text, p.segments);
      const { bytes } = encodeForDownload(applied, p.encoding);
      archiveTranslated.set(p.f.name, bytes);
      archiveDone.add(p.f.name);
      doneFiles++; doneSegs += p.todo.length;
    }
    toast(`Selesai: ${doneFiles} file .ks diterjemahkan ✅ — klik 📦 Kemas ulang .xp3 bila sudah cukup.`, false, 5000);
  } catch (e) {
    toast(`Gagal di file ke-${doneFiles + 1}: ${e.message} — ${doneFiles} file sudah ✅, ulangi untuk melanjutkan sisanya.`, true, 6000);
  } finally {
    renderArchiveRows($("arcSearch").value || "");
    refreshArchiveRepackButtons();
    arcTranslating = false;
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

$("btnArcTranslateKs").addEventListener("click", translateAllKs);

/** Kemas ulang arsip yang sedang dibuka di viewer (ypf/xp3) dari hasil terjemahan. */
async function repackArchiveViewer() {
  if (!archive || archiveDone.size === 0) return;
  const kind = archive.kind;
  if (kind !== "ypf" && kind !== "xp3") { toast("Kemas ulang belum didukung untuk jenis arsip ini.", true); return; }
  toast("Mengemas ulang arsip...");
  try {
    const { rebuildYpf } = kind === "ypf" ? await import(withVer("./parsers/ypf.js")) : {};
    const { rebuildXp3 } = kind === "xp3" ? await import(withVer("./parsers/xp3.js")) : {};
    const rebuild = kind === "ypf" ? rebuildYpf : rebuildXp3;
    const out = await rebuild(archive.buffer, archiveTranslated);
    // verifikasi: arsip hasil rebuild harus terbaca kembali
    const { parseYpf } = kind === "ypf" ? await import(withVer("./parsers/ypf.js")) : {};
    const { parseXp3 } = kind === "xp3" ? await import(withVer("./parsers/xp3.js")) : {};
    const check = kind === "ypf" ? await parseYpf(out) : await parseXp3(out);
    if (check.files.length !== archive.files.length)
      throw new Error("jumlah entri berubah — rebuild dibatalkan");
    const base = archive.fileName;
    const blob = new Blob([out], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = base;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`📦 ${base} dikemas ulang (${archiveDone.size} file diganti) ✅ — timpa file ini ke folder game.`, false, 6000);
  } catch (e) {
    console.error(e);
    toast("Gagal mengemas ulang: " + e.message, true, 6000);
  }
}

$("btnArcRepackYpf").addEventListener("click", repackArchiveViewer);
$("btnArcRepackXp3").addEventListener("click", repackArchiveViewer);

$("arcCheckAll").addEventListener("change", (e) => {
  document.querySelectorAll(".arcCheck").forEach((c) => { c.checked = e.target.checked; });
});

/* ---------- proyek terjemahan YU-RIS (.ybn dari arsip) ---------- */
let yurisBin = null; // { ypfName, special, parsed: Map<arcName, parsed> } — hanya di memori

$("btnArcTranslate").addEventListener("click", () => {
  const sel = [...document.querySelectorAll(".arcCheck:checked")].map((c) => c.dataset.arc);
  if (!sel.length) { toast("Pilih dulu file .ybn yang mau diterjemahkan.", true); return; }
  startYurisProject(sel);
});

async function startYurisProject(selNames) {
  toast("Membaca script YU-RIS...");
  try {
    const yscFile = archive.files.find((f) => f.name.toLowerCase().endsWith("ysc.ybn"));
    if (!yscFile) throw new Error("ysc.ybn tidak ditemukan di arsip ini.");
    const { special } = parseYsc(yscFile.data);
    const parsed = new Map();
    const segments = [];
    const failed = [];
    for (const arcName of selNames) {
      const f = archive.files.find((x) => x.name === arcName);
      if (!f) continue;
      let p;
      try {
        p = parseYstb(f.data, special);
      } catch (e) {
        console.warn("Lewati " + arcName + ": " + e.message);
        failed.push(arcName.split(/[\\/]/).pop());
        continue;
      }
      parsed.set(arcName, p);
      const base = arcName.split(/[\\/]/).pop();
      for (const w of p.words) {
        if (!w.text.trim()) continue;
        segments.push({
          key: `${arcName}::${w.key}`,
          file: arcName,
          wordKey: w.key,
          line: `${base} #${w.cmdIdx}`,
          speaker: w.speaker,
          speakerVar: "",
          kind: "dialog",
          source: w.body,
          translation: "",
          bracket: w.bracket,
        });
      }
    }
    if (!segments.length) { toast("Tidak ada teks yang bisa diekstrak dari file-file ini.", true); return; }
    yurisBin = { ypfName: archive.fileName, special, parsed };
    project = {
      id: newId(),
      name: `${archive.fileName} (${selNames.length} script)`,
      fileName: archive.fileName,
      engineId: "yuris-script",
      encoding: "shift-jis",
      ypfName: archive.fileName,
      yurisFiles: selNames,
      segments,
      warnings: [
        "Hanya string WORD (dialog/narasi) yang diterjemahkan. Kode kontrol: baris baru = Enter, \\p = ganti halaman, \\c = tunggu klik.",
        "Nama pembicara tidak bisa diubah di versi ini — ubah lewat file aslinya bila perlu.",
      ],
      glossary: [],
      updatedAt: Date.now(),
    };
    saveProject(project);
    toast(`${segments.length} segmen dari ${selNames.length - failed.length} file script.` +
      (failed.length ? ` Dilewati (${failed.length}): ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}` : ""));
    showView("editor");
  } catch (e) {
    console.error(e);
    toast("Gagal membaca script: " + e.message, true);
  }
}

function exportYuris() {
  const missingBin = !yurisBin || yurisBin.ypfName !== project.ypfName ||
    project.yurisFiles.some((fn) => !yurisBin.parsed.has(fn));
  if (missingBin) {
    toast("Data biner script tidak tersedia (mis. setelah reload). Upload ulang file .ypf yang sama, pilih file .ybn-nya lagi, lalu ekspor.", true);
    return;
  }
  const empty = project.segments.filter((s) => !s.translation || !s.translation.trim()).length;
  if (empty > 0 && !confirm(`${empty} segmen belum diterjemahkan dan akan memakai teks asli (Jepang). Lanjutkan ekspor?`)) return;
  const encodeSjis = (s) => new Uint8Array(Encoding.convert(s, { to: "SJIS", from: "UNICODE" }));
  let done = 0;
  const failed = [];
  for (const arcName of project.yurisFiles) {
    const parsed = yurisBin.parsed.get(arcName);
    const tr = new Map();
    for (const s of project.segments.filter((x) => x.file === arcName)) {
      const body = s.translation && s.translation.trim() ? s.translation : s.source;
      tr.set(s.wordKey, joinSpeaker(s.speaker, body, s.bracket));
    }
    try {
      const out = rebuildYstb(parsed, tr, encodeSjis);
      // verifikasi: parse ulang hasil rebuild, pastikan teksnya sesuai
      const chk = parseYstb(out, yurisBin.special);
      const expect = new Map([...tr.entries()].map(([k, v]) => [k, v]));
      const bad = chk.words.filter((w) => {
        const e = expect.get(w.key);
        return e !== undefined && w.text !== e;
      });
      if (bad.length) throw new Error(`${bad.length} string tidak cocok setelah rebuild (kemungkinan karakter tak bisa di-encode Shift-JIS).`);
      const base = arcName.split(/[\\/]/).pop();
      downloadFile(base, out, "application/octet-stream");
      // simpan untuk kemas ulang .ypf (bila arsipnya masih yang sama)
      if (archive && archive.kind === "ypf" && archive.fileName === project.ypfName) {
        archiveTranslated.set(arcName, out);
        archiveDone.add(arcName);
      }
      done++;
    } catch (e) {
      console.error(e);
      failed.push(`${arcName.split(/[\\/]/).pop()}: ${e.message}`);
    }
  }
  if (failed.length) toast(`Gagal mengekspor ${failed.length} file: ${failed[0]}`, true);
  else toast(`${done} file .ybn diekspor. Timpa ke folder hasil ekstrak .ypf, lalu repack arsipnya.`);
}

function downloadArchiveFile(i) {
  const f = archive.files[i];
  const base = f.name.split(/[\\/]/).pop() || "file";
  const url = URL.createObjectURL(new Blob([f.data]));
  const a = document.createElement("a");
  a.href = url; a.download = base;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Mengunduh ${base}`);
}

$("arcSearch").addEventListener("input", (e) => {
  if (archive) renderArchiveRows(e.target.value);
});

function startProject(fileName, text, encoding, engine) {  const { segments, warnings } = engine.parse(text, fileName);
  if (!segments.length) {
    toast("Tidak ada teks yang bisa diekstrak dari file ini.", true);
    return;
  }
  project = {
    id: newId(),
    name: fileName,
    fileName,
    engineId: engine.id,
    encoding,
    originalText: text,
    segments: segments.map((s) => ({ ...s })),
    warnings,
    glossary: [],
    updatedAt: Date.now(),
  };
  saveProject(project);
  if (warnings.length) toast(`Peringatan: ${warnings[0]}`, false, 4000);
  else toast(`${segments.length} segmen diekstrak dari ${engine.name}.`);
  showView("editor");
}

/* ---------- daftar proyek ---------- */
function renderProjectList() {
  const list = listProjects();
  const el = $("projectList");
  // v1.77: tombol Hapus Semua di Beranda — hanya muncul bila ada proyek
  const wipeBtn = $("btnWipeHome");
  if (wipeBtn) wipeBtn.style.display = list.length ? "" : "none";
  if (!list.length) { el.innerHTML = `<p class="muted">Belum ada proyek.</p>`; return; }
  el.innerHTML = list.map((p) => {
    const done = p.segments.filter((s) => s.translation).length;
    const pct = p.segments.length ? Math.round((done / p.segments.length) * 100) : 0;
    const eng = getEngine(p.engineId);
    return `<div class="toolbar" style="border-bottom:1px solid var(--line);padding:8px 0">
      <div><strong>${escHtml(p.name)}</strong><br>
      <span class="muted">${escHtml(eng ? eng.name : p.engineId)} · ${done}/${p.segments.length} (${pct}%) ·
      ${new Date(p.updatedAt).toLocaleString("id-ID")}</span></div>
      <div class="spacer"></div>
      <button class="btn" data-open="${p.id}">Buka</button>
      <button class="btn" data-export-proj="${p.id}">Unduh JSON</button>
      <button class="btn danger" data-del="${p.id}">Hapus</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      project = getProject(b.dataset.open);
      showView("editor");
      if (project.engineId === "yuris-script" && (!yurisBin || yurisBin.ypfName !== project.ypfName)) {
        toast("Proyek YU-RIS dibuka. Untuk ekspor, upload ulang file .ypf yang sama dulu (data biner tidak tersimpan).", false, 5000);
      }
    }));
  el.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      if (confirm("Hapus proyek ini?")) { deleteProject(b.dataset.del); renderProjectList(); }
    }));
  el.querySelectorAll("[data-export-proj]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = getProject(b.dataset.exportProj);
      downloadFile(p.fileName + ".vntrans.json", JSON.stringify(p), "application/json");
    }));
}

/* ---------- editor ---------- */
function engineOf() { return project ? getEngine(project.engineId) : null; }

function filteredSegments() {
  return project.segments.filter((s) => {
    if (filterMode === "empty" && s.translation) return false;
    if (filterMode === "done" && !s.translation) return false;
    if (searchTerm) {
      const hay = (s.source + " " + (s.translation || "")).toLowerCase();
      if (!hay.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  });
}

function renderEditor() {
  const empty = !project;
  $("editorEmpty").style.display = empty ? "" : "none";
  $("editorMain").style.display = empty ? "none" : "";
  if (empty) return;
  const eng = engineOf();
  $("edFileName").textContent = project.fileName;
  $("edEngine").textContent = eng.name;
  $("edEncoding").textContent = "encoding: " + project.encoding;
  // Tombol batch: hanya jika file berasal dari pindai folder & ada file se-engine lain
  const sibs = project.fileName.includes("/")
    ? folderRows.filter((r) => !r.archive && r.engine.id === project.engineId)
    : [];
  $("btnBatchFolder").style.display = sibs.length > 1 ? "" : "none";
  if (sibs.length > 1) $("btnBatchFolder").textContent = `📁⚡ Semua file (${sibs.length})`;

  const w = $("edWarnings");
  w.innerHTML = (project.warnings || []).map((x) =>
    `<div class="notice">${escHtml(x)}</div>`).join("");

  updateProgress();

  const rows = filteredSegments();
  const body = $("segBody");
  const MAX_RENDER = 2000;
  const shown = rows.slice(0, MAX_RENDER);
  body.innerHTML = shown.map((s) => {
    const idx = project.segments.indexOf(s);
    const done = !!s.translation;
    return `<tr class="${done ? "done" : ""}" data-idx="${idx}">
      <td class="line-no">${s.line}</td>
      <td class="src">${s.speaker ? `<span class="badge kind">${escHtml(s.speaker)}</span> ` : ""}${escHtml(s.source)}</td>
      <td><textarea class="tr" data-tr="${idx}" placeholder="Tulis terjemahan...">${escHtml(s.translation || "")}</textarea></td>
      <td><div class="row-actions">
        <button class="mini" data-mt="${idx}" title="Terjemahkan baris ini">⚡</button>
        <button class="mini" data-copy="${idx}" title="Salin teks asli">⧉</button>
      </div></td>
    </tr>`;
  }).join("") + (rows.length > MAX_RENDER
    ? `<tr><td colspan="4" class="muted" style="text-align:center">Menampilkan ${MAX_RENDER} dari ${rows.length} — gunakan pencarian/filter.</td></tr>` : "");

  body.querySelectorAll("[data-tr]").forEach((ta) => {
    ta.addEventListener("input", () => {
      const i = +ta.dataset.tr;
      project.segments[i].translation = ta.value;
      ta.closest("tr").classList.toggle("done", !!ta.value.trim());
      updateProgress();
      queueSave();
    });
  });
  body.querySelectorAll("[data-mt]").forEach((b) =>
    b.addEventListener("click", () => translateOne(+b.dataset.mt, b)));
  body.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = project.segments[+b.dataset.copy];
      navigator.clipboard.writeText(s.source).then(() => toast("Teks asli disalin."));
    }));
}

function updateProgress() {
  const total = project.segments.length;
  const done = project.segments.filter((s) => s.translation && s.translation.trim()).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("edProgressBar").style.width = pct + "%";
  $("edProgressText").textContent = `${done}/${total} (${pct}%)`;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (project) saveProject(project); }, 800);
}

$("searchBox").addEventListener("input", (e) => { searchTerm = e.target.value; renderEditor(); });
$("filterSel").addEventListener("change", (e) => { filterMode = e.target.value; renderEditor(); });
$("btnSaveProj").addEventListener("click", () => {
  if (!project) return;
  saveProject(project);
  toast("Proyek disimpan di browser ini.");
});

/* ---------- terjemahan mesin ---------- */
function mtArgs() {
  const p = getProvider(settings.providerId);
  return {
    providerId: settings.providerId,
    apiKey: keys[settings.providerId] || "",
    endpoint: settings.libreEndpoint,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    glossary: project.glossary,
    model: GEMINI_MODEL_ALIAS[settings.geminiModel] || settings.geminiModel || "gemini-3.5-flash",
    onModelFallback: (from, to) => toast(`Model ${from} sibuk — dialihkan otomatis ke ${to}.`, false, 3500),
  };
}

async function translateOne(idx, btn) {
  const s = project.segments[idx];
  if (!s.source.trim()) return;
  btn.disabled = true;
  try {
    const [t] = await translateBatch({ ...mtArgs(), texts: [s.source], onProgress: null });
    s.translation = t;
    saveProject(project);
    renderEditor();
    toast("Baris diterjemahkan.");
  } catch (e) {
    toast(e.message, true, 4000);
  } finally {
    btn.disabled = false;
  }
}

$("btnBatchFolder").addEventListener("click", () => {
  if (!project || batchRunning) return;
  const eng = engineOf();
  const n = folderRows.filter((r) => !r.archive && r.engine.id === project.engineId).length;
  if (n < 2) return;
  if (!confirm(
    `Terjemahkan otomatis SEMUA ${n} file ${eng.name} dari folder yang dipindai?\n\n` +
    `File yang sedang dibuka ikut diproses — terjemahan yang sudah ada dipakai, tidak diterjemahkan ulang.\n` +
    `Hasilnya diunduh sebagai 1 ZIP dengan struktur folder utuh.`
  )) return;
  showView("home"); // progres batch tampil di Beranda
  batchTranslateGroup(project.engineId, eng.name);
});
/* 🔋 Bilah #mtProgress sebagai "baterai ngecas": chShow (tampil 0%),
 * chSet(persen, teks, mode) — mode: "" jalan / "wait" jeda limit / "done" penuh,
 * chHide: sembunyikan. */
function chShow() {
  const bar = $("mtProgress");
  bar.style.display = "";
  bar.classList.remove("waiting", "done");
  $("chFill").style.width = "0%";
  $("chText").textContent = "";
  chLastPct = 0;
}
let chLastPct = 0;
function chSet(done, total, label, mode) {
  const bar = $("mtProgress");
  bar.style.display = "";
  bar.classList.toggle("waiting", mode === "wait");
  bar.classList.toggle("done", mode === "done");
  // mode "wait": pertahankan isi warna di posisi terakhir, hanya teks + denyut yang berubah
  const pct = mode === "wait" ? chLastPct : (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
  if (mode !== "wait") chLastPct = pct;
  $("chFill").style.width = pct + "%";
  $("chText").textContent = label !== undefined ? label : `${pct}%`;
}
function chHide() {
  const bar = $("mtProgress");
  bar.style.display = "none";
  bar.classList.remove("waiting", "done");
}

$("btnAutoMT").addEventListener("click", async () => {
  if (!project) return;
  const targets = project.segments.filter((s) => !s.translation || !s.translation.trim());
  if (!targets.length) { toast("Semua segmen sudah diterjemahkan."); return; }
  const p = getProvider(settings.providerId);
  if (!confirm(`Terjemahkan ${targets.length} segmen kosong dengan ${p.name} (${settings.sourceLang}→${settings.targetLang})?`)) return;

  chShow();
  $("btnAutoMT").disabled = true;
  let lastChunkSave = 0, quotaWarned = false;
  try {
    const texts = targets.map((s) => s.source);
    const out = await translateBatch({
      ...mtArgs(),
      texts,
      onProgress: (done, total) => {
        chSet(done, total, `⚡ Menerjemahkan… ${done}/${total}`);
      },
      // Simpan bertahap tiap chunk: refresh di tengah jalan tidak mengulang dari awal
      onChunk: (partial) => {
        for (let k = 0; k < partial.length && k < targets.length; k++) {
          if (!targets[k].translation?.trim() && partial[k]?.trim()) targets[k].translation = partial[k];
        }
        const now = Date.now();
        if (now - lastChunkSave > 10000) {
          lastChunkSave = now;
          if (!saveProject(project) && !quotaWarned) {
            quotaWarned = true;
            toast("⚠️ Penyimpanan browser penuh — progres mungkin tidak tersimpan. Hapus proyek lama di Arsip.", true, 7000);
          }
        }
      },
      onWait: (s) => {
        chSet(0, 0, `⏳ Limit — jeda ${s} dtk, lanjut otomatis…`, "wait");
        $("btnAutoMT").textContent = `⏳ Jeda ${s} dtk…`;
      },
    });
    targets.forEach((s, i) => { s.translation = out[i]; });
    saveProject(project);
    renderEditor();
    chSet(1, 1, `✅ Selesai: ${out.length} segmen diterjemahkan.`, "done");
    setTimeout(() => { if (!$("btnAutoMT").disabled) chHide(); }, 3500);
    toast(`Selesai: ${out.length} segmen diterjemahkan. Silakan periksa & sunting manual.`);
  } catch (e) {
    chHide();
    saveProject(project); // simpan progres yang sempat selesai sebelum gagal
    toast("Gagal: " + e.message + " — progres yang sudah selesai tersimpan, klik lagi untuk lanjut.", true, 7000);
  } finally {
    chHide();
    $("btnAutoMT").disabled = false;
    $("btnAutoMT").textContent = "⚡ Terjemahkan Otomatis";
  }
});

/* ✨ Poles kalimat: perbaiki tata bahasa & kefasihan SEMUA terjemahan yang
 * sudah ada (makna dijaga, placeholder [ph id=N] tidak diubah).
 * Memakai provider terjemahan yang dipilih bila bisa memoles
 * (Gemini/Claude/Groq/DeepSeek/OpenAI), fallback ke Gemini. */
$("btnPolish").addEventListener("click", async () => {
  if (!project) return;
  const targets = project.segments.filter((s) => s.translation && s.translation.trim());
  if (!targets.length) { toast("Belum ada terjemahan — terjemahkan dulu.", true); return; }
  const pp = resolvePolishProvider();
  if (!pp) { toast("Butuh API key di tab Pengaturan untuk poles kalimat (Gemini/Claude/Groq/DeepSeek/OpenAI).", true, 4500); return; }
  const gap = polishGap(pp);
  const estMin = Math.max(1, Math.round(Math.ceil(targets.length / 15) * gap / 60));
  if (!confirm(
    `Poles ${targets.length} kalimat terjemahan dengan ${pp.name}?\n\n` +
    `Tata bahasa, typo, dan kefasihan diperbaiki massal — makna, nama tokoh,\n` +
    `dan penanda [ph id=N] dijaga. Terjemahan yang sudah ada akan DITIMPA.\n\n` +
    `Estimasi ±${estMin} menit. Tetap periksa hasilnya sebelum ekspor.`
  )) return;

  chShow();
  $("btnPolish").disabled = true;
  let lastChunkSaveP = 0, quotaWarnedP = false;
  try {
    const out = await proofreadBatch({
      providerId: pp.id,
      oai: pp.oai,
      apiKey: pp.apiKey,
      model: GEMINI_MODEL_ALIAS[settings.geminiModel] || settings.geminiModel || "gemini-3.5-flash",
      targetLang: settings.targetLang,
      texts: targets.map((s) => s.translation),
      onProgress: (done, total) => {
        chSet(done, total, `✨ Memoles kalimat… ${done}/${total}`);
      },
      // Simpan bertahap tiap chunk: refresh di tengah jalan tidak mengulang dari awal
      onChunk: (partial) => {
        for (let k = 0; k < partial.length && k < targets.length; k++) {
          if (partial[k]?.trim()) targets[k].translation = partial[k];
        }
        const now = Date.now();
        if (now - lastChunkSaveP > 10000) {
          lastChunkSaveP = now;
          if (!saveProject(project) && !quotaWarnedP) {
            quotaWarnedP = true;
            toast("⚠️ Penyimpanan browser penuh — progres mungkin tidak tersimpan. Hapus proyek lama di Arsip.", true, 7000);
          }
        }
      },
      onWait: (s) => {
        chSet(0, 0, `⏳ Limit — jeda ${s} dtk, lanjut otomatis…`, "wait");
        $("btnPolish").textContent = `⏳ Jeda ${s} dtk…`;
      },
      onModelFallback: (from, to) => toast(`Model ${from} sibuk — dialihkan otomatis ke ${to}.`, false, 3500),
    });
    targets.forEach((s, i) => { s.translation = out[i]; });
    saveProject(project);
    renderEditor();
    // sinkronkan ke hasil batch bila file ini dari pindai folder (untuk kemas ulang)
    if (project.fileName && project.fileName.includes("/")) {
      const { bytes } = encodeForDownload(engineOf().apply(project.originalText, project.segments), project.encoding);
      translatedOutputs.set(project.fileName, bytes);
      translatedSegments.set(project.fileName, project.segments.map((s) => ({ ...s })));
      polishedDone.add(project.fileName);
      persistTranslation(folderRows.find((r) => r.path === project.fileName), project.segments, bytes);
    }
    toast(`Selesai: ${out.length} kalimat dipoles ✨ — periksa sebelum ekspor.`);
    chSet(1, 1, `✅ Selesai: ${out.length} kalimat dipoles ✨`, "done");
    setTimeout(() => { if (!$("btnPolish").disabled) chHide(); }, 3500);
  } catch (e) {
    chHide();
    saveProject(project); // simpan progres yang sempat selesai sebelum gagal
    toast("Gagal: " + e.message + " — progres yang sudah selesai tersimpan, klik lagi untuk lanjut.", true, 7000);
  } finally {
    chHide();
    $("btnPolish").disabled = false;
    $("btnPolish").textContent = "✨ Poles kalimat";
  }
});

/* ---------- glosarium ---------- */
function openGlossary() {
  renderGlossRows();
  $("glossModal").classList.add("open");
}
function renderGlossRows() {
  const el = $("glossRows");
  el.innerHTML = "";
  project.glossary.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "gloss-row";
    row.innerHTML = `<input type="text" placeholder="Istilah asli" value="${escHtml(g.source)}" data-gs="${i}">
      <input type="text" placeholder="Terjemahan" value="${escHtml(g.target)}" data-gt="${i}">
      <button class="mini" data-gdel="${i}">✕</button>`;
    el.appendChild(row);
  });
  el.querySelectorAll("[data-gs]").forEach((inp) =>
    inp.addEventListener("input", () => { project.glossary[+inp.dataset.gs].source = inp.value; }));
  el.querySelectorAll("[data-gt]").forEach((inp) =>
    inp.addEventListener("input", () => { project.glossary[+inp.dataset.gt].target = inp.value; }));
  el.querySelectorAll("[data-gdel]").forEach((b) =>
    b.addEventListener("click", () => { project.glossary.splice(+b.dataset.gdel, 1); renderGlossRows(); }));
}
$("btnGlossary").addEventListener("click", () => { if (project) openGlossary(); });
$("btnAddGloss").addEventListener("click", () => {
  project.glossary.push({ source: "", target: "" });
  renderGlossRows();
});
$("btnSaveGloss").addEventListener("click", () => {
  project.glossary = project.glossary.filter((g) => g.source.trim());
  saveProject(project);
  $("glossModal").classList.remove("open");
  toast(`Glosarium disimpan (${project.glossary.length} istilah).`);
});
$("btnCloseGloss").addEventListener("click", () => $("glossModal").classList.remove("open"));
$("glossModal").addEventListener("click", (e) => {
  if (e.target === $("glossModal")) $("glossModal").classList.remove("open");
});

/* ---------- ekspor ---------- */
$("btnExport").addEventListener("click", async () => {
  if (!project) return;
  if (project.engineId === "yuris-script") { exportYuris(); return; }
  const eng = engineOf();
  const empty = project.segments.filter((s) => !s.translation || !s.translation.trim()).length;
  if (empty > 0 && !confirm(`${empty} segmen belum diterjemahkan dan akan dikosongkan/dilewati. Lanjutkan ekspor?`)) return;
  const out = eng.apply(project.originalText, project.segments);
  const { bytes, encoding } = encodeForDownload(out, project.encoding);
  const baseName = project.fileName.split("/").pop().replace(/(\.[^.]+)?$/, (m) => `_id${m || ".txt"}`);
  const dl = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  if (project.fileName.includes("/")) {
    // Berasal dari pindai folder: ZIP pertahankan struktur folder,
    // jadi pengguna tahu persis ke mana file dikembalikan.
    // Simpan juga ke hasil batch agar koreksi di editor ikut dikemas ulang.
    translatedOutputs.set(project.fileName, bytes);
    translatedSegments.set(project.fileName, project.segments.map((s) => ({ ...s })));
    batchDone.add(project.fileName);
    polishedDone.delete(project.fileName); // editan manual -> layak dipoles lagi
    const row = folderRows.find((r) => r.path === project.fileName);
    persistTranslation(row, project.segments, bytes); // simpan ke cache 24 jam
    const mark = document.querySelector(`#uploadInfo [data-fdone="${CSS.escape(project.fileName)}"]`);
    if (mark) mark.textContent = "✅";
    refreshRepackButtons(row && row.archivePath);
    const zip = new JSZip();
    zip.file(project.fileName, bytes);
    dl(await zip.generateAsync({ type: "blob" }), baseName.replace(/(\.[^.]+)?$/, "") + ".zip");
    toast(`Diekspor sebagai ZIP (${encoding.toUpperCase()}) — ekstrak ke folder game, struktur folder dipertahankan.`);
    return;
  }
  if (project.archiveEntry && archive && archive.fileName === project.archiveEntry.archiveName) {
    archiveTranslated.set(project.archiveEntry.entryName, bytes);
    archiveDone.add(project.archiveEntry.entryName);
  }
  dl(new Blob([bytes], { type: "text/plain;charset=" + encoding }), baseName);
  toast(`Diekspor sebagai ${encoding.toUpperCase()}.`);
});

$("btnExportCSV").addEventListener("click", () => {
  if (!project) return;
  const csv = toCSV([
    ["baris", "pembicara", "sumber", "terjemahan"],
    ...project.segments.map((s) => [s.line, s.speaker, s.source, s.translation || ""]),
  ]);
  downloadFile(project.fileName + ".csv", "\ufeff" + csv, "text/csv;charset=utf-8");
  toast("CSV diunduh.");
});

/* ---------- unduh langsung: nama asli, tanpa _id/ZIP/dialog — untuk repack ---------- */
$("btnDownload").addEventListener("click", () => {
  if (!project) return;
  if (project.engineId === "yuris-script") { exportYuris(); return; }
  const eng = engineOf();
  const out = eng.apply(project.originalText, project.segments);
  const { bytes, encoding } = encodeForDownload(out, project.encoding);
  // Sinkronkan koreksi terbaru ke hasil batch agar "Buat patch.xp3"/repack memakainya.
  if (project.fileName.includes("/")) {
    translatedOutputs.set(project.fileName, bytes);
    translatedSegments.set(project.fileName, project.segments.map((s) => ({ ...s })));
    batchDone.add(project.fileName);
    polishedDone.delete(project.fileName);
    const row = folderRows.find((r) => r.path === project.fileName);
    persistTranslation(row, project.segments, bytes);
    const mark = document.querySelector(`#uploadInfo [data-fdone="${CSS.escape(project.fileName)}"]`);
    if (mark) mark.textContent = "✅";
    refreshRepackButtons(row && row.archivePath);
  }
  if (project.archiveEntry && archive && archive.fileName === project.archiveEntry.archiveName) {
    archiveTranslated.set(project.archiveEntry.entryName, bytes);
    archiveDone.add(project.archiveEntry.entryName);
  }
  const name = project.fileName.split("/").pop();
  downloadFile(name, bytes, "text/plain;charset=" + encoding);
  toast(`Diunduh: ${name} (${encoding.toUpperCase()}) — siap untuk repack.`);
});

/* ---------- daftar engine ---------- */
function renderEngines() {
  $("engineBody").innerHTML = ENGINES.map((e) => `
    <tr>
      <td><strong>${escHtml(e.name)}</strong></td>
      <td>${e.exts.map((x) => `<span class="kbd">${escHtml(x)}</span>`).join(" ") || "-"}</td>
      <td>${e.status === "supported"
        ? `<span class="badge ok">didukung</span>`
        : `<span class="badge soon">segera hadir</span>`}</td>
      <td class="muted">${escHtml(e.description || "")}</td>
    </tr>`).join("");
}

/* ---------- pengaturan ---------- */
function renderSettings() {
  const prov = $("setProvider");
  prov.innerHTML = MT_PROVIDERS.map((p) =>
    `<option value="${p.id}"${p.id === settings.providerId ? " selected" : ""}>${escHtml(p.name)}</option>`).join("");
  const langOpts = (sel) => LANGS.map((l) =>
    `<option value="${l.code}"${l.code === sel ? " selected" : ""}>${escHtml(l.label)}</option>`).join("");
  const srcOpts = (sel) => SOURCE_LANGS.map((l) =>
    `<option value="${l.code}"${l.code === sel ? " selected" : ""}>${escHtml(l.label)}</option>`).join("");
  $("setSrc").innerHTML = srcOpts(settings.sourceLang);
  $("setTgt").innerHTML = langOpts(settings.targetLang);
  const curGemini = GEMINI_MODEL_ALIAS[settings.geminiModel] || settings.geminiModel || "gemini-3.8-flash";
  $("setGeminiModel").innerHTML = GEMINI_MODELS.map((m) =>
    `<option value="${m.id}"${m.id === curGemini ? " selected" : ""}>${escHtml(m.name)}</option>`).join("");
  syncProviderUI();
}
function syncProviderUI() {
  const p = getProvider($("setProvider").value);
  $("provHelp").innerHTML = escHtml(p.help || "") +
    (p.keyUrl ? `<br><a href="${p.keyUrl}" target="_blank" rel="noopener">${escHtml(p.keyUrlLabel || "Dapatkan key gratis →")}</a>` : "");
  $("setKey").value = keys[p.id] || "";
  $("setKey").closest("label").style.display = (p.needsKey || p.optionalKey || p.id === "libretranslate") ? "" : "none";
  $("setKey").placeholder = p.keyPlaceholder || "opsional";
  // label dinamis: "API key" vs "Email"
  $("setKey").closest("label").childNodes[0].textContent = (p.keyLabel || "API key") + " ";
  $("setKey").type = p.id === "mymemory" ? "email" : "password";
  $("setGeminiModel").closest("label").style.display = p.id === "gemini" ? "" : "none";
  $("setEndpoint").value = settings.libreEndpoint || "";
  $("setEndpoint").closest("label").style.display = p.customEndpoint ? "" : "none";
  // Tombol cek kuota/saldo: DeepL (sisa karakter) & DeepSeek (sisa saldo).
  // Engine lain (Gemini/Groq/OpenAI/Claude/MyMemory/Libre) tidak punya endpoint kuota publik.
  const quotaLabels = { deepl: "📊 Cek Kuota DeepL", deepseek: "📊 Cek Saldo DeepSeek" };
  const qLabel = quotaLabels[p.id];
  $("quotaRow").style.display = qLabel ? "flex" : "none";
  if (qLabel) $("btnCheckQuota").textContent = qLabel;
  else $("quotaResult").textContent = "";
}
$("setProvider").addEventListener("change", syncProviderUI);
$("btnSaveSettings").addEventListener("click", () => {
  settings.providerId = $("setProvider").value;
  settings.sourceLang = $("setSrc").value;
  settings.targetLang = $("setTgt").value;
  settings.libreEndpoint = $("setEndpoint").value.trim();
  settings.geminiModel = $("setGeminiModel").value;
  keys[settings.providerId] = $("setKey").value.trim();
  saveSettings(settings);
  saveKeys(keys);
  toast("Pengaturan disimpan.");
});
// v1.77: hapus semua proyek — dipakai tombol di Pengaturan (btnWipe)
// dan tombol di Beranda (btnWipeHome); Hapus per proyek tetap ada.
function wipeAllProjects() {
  if (confirm("Hapus SEMUA proyek tersimpan? Tindakan ini tidak bisa dibatalkan.")) {
    localStorage.removeItem("vntrans.projects.v1");
    renderProjectList();
    toast("Semua proyek dihapus.");
  }
}
$("btnWipe").addEventListener("click", wipeAllProjects);
$("btnWipeHome").addEventListener("click", wipeAllProjects);
$("btnCheckQuota").addEventListener("click", async () => {
  if ($("setProvider").value === "deepseek") return checkDeepSeekBalance();
  const key = ($("setKey").value || keys.deepl || "").trim();
  const resEl = $("quotaResult");
  if (!key) { toast("Isi dulu API key DeepL di atas.", true); return; }
  resEl.textContent = "Mengecek kuota…";
  try {
    const res = await fetch("https://deepl.arvanity.my.id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "deepl-usage", key }),
    });
    if (res.status === 403) { resEl.textContent = "Key ditolak DeepL — periksa kembali key-nya."; return; }
    if (!res.ok) { resEl.textContent = `Gagal cek kuota (HTTP ${res.status}).`; return; }
    const data = await res.json();
    if (typeof data.character_count !== "number" || typeof data.character_limit !== "number") {
      resEl.textContent = "Respons tak dikenal dari DeepL.";
      return;
    }
    const used = data.character_count, limit = data.character_limit;
    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    const left = Math.max(0, limit - used);
    resEl.textContent = `Terpakai ${used.toLocaleString("id-ID")}/${limit.toLocaleString("id-ID")} (${pct}%) — sisa ${left.toLocaleString("id-ID")} karakter. Reset tiap awal bulan.`;
  } catch (e) {
    resEl.textContent = "Proxy DeepL belum bisa dihubungi. Coba lagi nanti.";
  }
});

async function checkDeepSeekBalance() {
  const key = ($("setKey").value || keys.deepseek || "").trim();
  const resEl = $("quotaResult");
  if (!key) { toast("Isi dulu API key DeepSeek di atas.", true); return; }
  resEl.textContent = "Mengecek saldo…";
  try {
    const res = await fetch("https://deepl.arvanity.my.id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "deepseek-balance", key }),
    });
    if (res.status === 401) { resEl.textContent = "Key ditolak DeepSeek — periksa kembali key-nya."; return; }
    if (!res.ok) { resEl.textContent = `Gagal cek saldo (HTTP ${res.status}).`; return; }
    const data = await res.json();
    const infos = data && data.balance_infos;
    if (!data || data.is_available === false || !Array.isArray(infos) || infos.length === 0) {
      resEl.textContent = "Respons tak dikenal dari DeepSeek.";
      return;
    }
    const info = infos.find(i => i.currency === "USD") || infos[0];
    const total = parseFloat(info.total_balance);
    const shown = isNaN(total) ? String(info.total_balance) : total.toFixed(2);
    resEl.textContent = `Sisa saldo: ${shown} ${info.currency || ""}`.trim() + ".";
  } catch (e) {
    resEl.textContent = "Proxy belum bisa dihubungi. Coba lagi nanti.";
  }
}

/* ---------- tema ---------- */
const THEME_KEY = "vntrans.theme";
function themeMode() {
  try { return localStorage.getItem(THEME_KEY) || "auto"; }
  catch { return "auto"; }
}
function applyTheme(mode) {
  const root = document.documentElement;
  const paint = (dark) => root.setAttribute("data-theme", dark ? "dark" : "light");
  if (mode === "dark") paint(true);
  else if (mode === "light") paint(false);
  else paint(window.matchMedia("(prefers-color-scheme: dark)").matches);
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* abaikan */ }
  const sel = $("themeSel");
  if (sel) sel.value = mode;
}
// Ikuti perubahan tema sistem saat mode "Otomatis"
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (themeMode() === "auto") applyTheme("auto");
});
$("themeSel").addEventListener("change", (e) => {
  applyTheme(e.target.value);
  toast("Tema: " + e.target.selectedOptions[0].textContent.trim());
});

/* ---------- init ---------- */
applyTheme(themeMode());
// Penanda versi di UI (header + Pengaturan) — biar kelihatan kalau web sudah update.
try {
  $("appVer").textContent = "v" + APP_VER;
  $("appVerSettings").textContent = "v" + APP_VER;
} catch {}
renderProjectList();
showView("home");
