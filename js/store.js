/* Penyimpanan proyek di localStorage (per-browser, privat).
 * Proyek: { id, name, fileName, engineId, encoding, segments[], glossary[], settings{}, updatedAt }
 */
const LS_PROJECTS = "vntrans.projects.v1";
const LS_SETTINGS = "vntrans.settings.v1";
const LS_KEYS = "vntrans.keys.v1";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch {
    return false; // kuota penuh — pemanggil memutuskan peringatan
  }
}

export function listProjects() {
  return read(LS_PROJECTS, []);
}
export function saveProject(proj) {
  const all = listProjects();
  proj.updatedAt = Date.now();
  const i = all.findIndex((p) => p.id === proj.id);
  if (i >= 0) all[i] = proj;
  else all.unshift(proj);
  return write(LS_PROJECTS, all.slice(0, 30)); // batasi 30 proyek; false bila kuota penuh
}
export function getProject(id) {
  return listProjects().find((p) => p.id === id);
}
export function deleteProject(id) {
  write(LS_PROJECTS, listProjects().filter((p) => p.id !== id));
}

export function loadSettings() {
  return read(LS_SETTINGS, {
    providerId: "mymemory",
    sourceLang: "ja",
    targetLang: "id",
    libreEndpoint: "https://libretranslate.com/translate",
    geminiModel: "gemini-3.8-flash",
  });
}
export function saveSettings(s) {
  write(LS_SETTINGS, s);
}

export function loadKeys() {
  return read(LS_KEYS, { deepl: "", libretranslate: "" });
}
export function saveKeys(k) {
  write(LS_KEYS, k);
}

export function newId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function downloadFile(fileName, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function toCSV(rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
