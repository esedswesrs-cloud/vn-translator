/* Decompile Ren'Py .rpyc langsung di browser.
 * Memakai unrpyc-pure v1.1.0 (MIT, https://github.com/asakuraminani/unrpyc-pure)
 * yang di-bundle ke js/vendor/unrpyc-pure.bundle.js.
 * Modul dimuat malas (lazy) — 69KB hanya diunduh saat benar-benar dibutuhkan.
 */
let apiPromise = null;

function loadApi() {
  if (!apiPromise) {
    apiPromise = import("./vendor/unrpyc-pure.bundle.js").catch((e) => {
      apiPromise = null;
      throw new Error("Gagal memuat mesin decompile: " + (e.message || e));
    });
  }
  return apiPromise;
}

/* buf: ArrayBuffer/Uint8Array berisi file .rpyc -> teks .rpy */
export async function decompileRpycBuffer(buf) {
  const api = await loadApi();
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out;
  try {
    out = await api.decompileRpyc(u8);
  } catch (e) {
    throw new Error("Decompile gagal: " + (e.message || e));
  }
  if (!out || !String(out).trim()) throw new Error("Hasil decompile kosong — file mungkin rusak atau format tak dikenal.");
  return String(out);
}
