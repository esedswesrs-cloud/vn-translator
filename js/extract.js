/* Ekstraksi arsip langsung di browser:
 * - Ren'Py .rpa  -> via unrpyc-pure (MIT), fungsi openRpa
 * - Artemis .pfs -> via js/parsers/pfs.js (port pfs-rs, MIT)
 * Modul dimuat malas — bundle unrpyc-pure (69KB) hanya diunduh saat dibutuhkan.
 */
import { openPfs } from "./parsers/pfs.js";

let rpaApiPromise = null;
function loadRpaApi() {
  if (!rpaApiPromise) {
    rpaApiPromise = import("./vendor/unrpyc-pure.bundle.js").catch((e) => {
      rpaApiPromise = null;
      throw new Error("Gagal memuat mesin ekstraksi: " + (e.message || e));
    });
  }
  return rpaApiPromise;
}

/* Daftar entri script (.rpyc/.rpy) di dalam .rpa.
 * return [{ path, entry, archive }] — baca/decompile on-demand. */
export async function listRpaScripts(buffer) {
  const api = await loadRpaApi();
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let archive;
  try {
    archive = await api.openRpa(u8);
  } catch (e) {
    throw new Error("Gagal membuka .rpa: " + (e.message || e));
  }
  const out = [];
  for (const [path, entry] of archive.files) {
    const l = path.toLowerCase();
    if (l.endsWith(".rpyc") || l.endsWith(".rpy")) out.push({ path, entry, archive });
  }
  return out;
}

/* Ambil teks satu entri .rpa: .rpyc di-decompile, .rpy dibaca langsung. */
export async function readRpaScript(item) {
  const l = item.path.toLowerCase();
  if (l.endsWith(".rpyc")) {
    return { kind: "rpyc", text: await item.archive.decompile(item.entry) };
  }
  return { kind: "rpy", text: await item.archive.readText(item.entry) };
}

/* Buka .pfs -> { entries: [{name, size}], getData(i) } (lihat parsers/pfs.js). */
export async function openPfsArchive(buffer) {
  return openPfs(buffer);
}

/* Entri script (.ast/.txt/.iet) di dalam .pfs. */
export function listPfsScripts(pfs) {
  const out = [];
  pfs.entries.forEach((e, i) => {
    if (/\.(ast|txt|iet)$/i.test(e.name)) out.push({ index: i, name: e.name, size: e.size });
  });
  return out;
}
