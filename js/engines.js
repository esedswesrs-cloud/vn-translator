/* Registry engine + deteksi otomatis.
 * Daftar engine mengikuti tabel umum komunitas (22 engine).
 * v1: Ren'Py, Kirikiri, RealLive didukung penuh. Sisanya "segera hadir".
 */
import { RENPY } from "./parsers/renpy.js";
import { KIRIKIRI } from "./parsers/kirikiri.js";
import { REALLIVE } from "./parsers/reallive.js";
import { TYRANO } from "./parsers/tyrano.js";
import { RPGMAKER, looksLikeRpgMaker } from "./parsers/rpgmaker.js";
import { YURIS } from "./parsers/ypf.js";
import { YURIS_SCRIPT } from "./parsers/yuris.js";
import { KIRIKIRI_XP3 } from "./parsers/xp3.js";
import { ARTEMIS } from "./parsers/artemis.js";
import { ARTEMIS_AST } from "./parsers/artemis-ast.js";
import { NANINOVEL } from "./parsers/naninovel.js";

const SUPPORTED = [RENPY, KIRIKIRI, REALLIVE, TYRANO, RPGMAKER, YURIS, KIRIKIRI_XP3, ARTEMIS, ARTEMIS_AST, NANINOVEL];

// Engine lain dari tabel referensi — parser menyusul di pembaruan berikutnya
const COMING_SOON = [
  { id: "advhd", name: "AdvHD", exts: [".ws2"] },
  { id: "arcgame", name: "ArcGameEngine", exts: [".bin"] },
  { id: "artemis-asb", name: "Artemis (.asb biner)", exts: [".asb"] },
  { id: "bgi", name: "Buriko General Interpreter/Ethornell", exts: [] },
  { id: "catsystem2", name: "CatSystem2", exts: [".cst"] },
  { id: "cyberworks", name: "Cyberworks C,system", exts: [".a0"] },
  { id: "kaguya", name: "KaGuYa", exts: ["message.dat"] },
  { id: "majiro", name: "Majiro", exts: [".mjo"] },
  { id: "musica", name: "Musica", exts: [".sc"] },
  { id: "mware", name: "Mware", exts: [".nut"] },
  { id: "propeller", name: "Propeller/Stuff Script Engine", exts: [".msc"] },
  { id: "shsystem", name: "ShSystem", exts: [".hst"] },
  { id: "silkys", name: "Silky's/AI6WIN", exts: [".mes", ".map"] },
  { id: "qlie", name: "Qlie", exts: [".s"] },
  { id: "softpal", name: "Softpal", exts: ["script.src"] },
  { id: "systemnnn", name: "SystemNNN", exts: [".nnn", ".spt"] },
  { id: "tmrhiro", name: "TmrHiroAdvSystem", exts: [".srp"] },
  { id: "whale", name: "Whale", exts: [".txt"] },
].map((e) => ({ ...e, status: "soon", description: "Dukungan menyusul di pembaruan berikutnya." }));

export const ENGINES = [...SUPPORTED, YURIS_SCRIPT, ...COMING_SOON];

export function getEngine(id) {
  return ENGINES.find((e) => e.id === id);
}

function extOf(fileName) {
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i).toLowerCase() : "";
}

/* Deteksi engine dari nama file + isi (untuk .txt yang ambigu) */
export function detectEngine(fileName, text) {
  const ext = extOf(fileName);
  const base = fileName.lastIndexOf("/") >= 0 || fileName.lastIndexOf("\\") >= 0
    ? fileName.split(/[\\/]/).pop()
    : fileName;

  // RPG Maker: kenali dari nama file / struktur JSON (ekstensi .json generik)
  if (ext === ".json") {
    let data = null;
    try { data = JSON.parse(text); } catch { /* bukan JSON */ }
    if (looksLikeRpgMaker(data, base)) {
      const e = getEngine("rpgmaker");
      return { engine: e, candidates: [e] };
    }
    return { engine: null, candidates: [] };
  }

  const cands = SUPPORTED.filter(
    (e) => e.exts.includes(ext) || e.exts.includes(base.toLowerCase())
  );
  if (cands.length === 0) return { engine: null, candidates: [] };
  if (cands.length === 1) return { engine: cands[0], candidates: cands };

  let engine = cands[0];
  const sample = text.slice(0, 4000);
  // .ks ambigu: Kirikiri KAG vs TyranoScript -> skor penanda khas
  if (cands.some((c) => c.id === "tyrano") && cands.some((c) => c.id === "kirikiri")) {
    const tScore =
      ((sample.match(/^\s*#/gm) || []).length * 3) +
      ((sample.match(/\[(iscript|chara_new|chara_show|chara_hide|tb_)/gi) || []).length * 2) +
      ((sample.match(/\[(bg|mtext|font|emb)\b/gi) || []).length);
    const kScore =
      ((sample.match(/^\s*@/gm) || []).length * 3) +
      ((sample.match(/\[(layopt|trans|history|rclick|current)\b/gi) || []).length * 2);
    engine = tScore > kScore ? getEngine("tyrano") : getEngine("kirikiri");
    return { engine, candidates: cands };
  }

  // .txt ambigu: Kirikiri vs RealLive vs Artemis -> intip isi
  const hashCmd = (sample.match(/^#/gm) || []).length;
  const kagMarks =
    (sample.match(/^\s*;/gm) || []).length +
    (sample.match(/^\s*\*/gm) || []).length +
    (sample.match(/^\s*@/gm) || []).length +
    (sample.match(/\[[a-zA-Z]/g) || []).length;
  // Penanda khas Artemis: perintah [name ...] dan [sel_text ...]
  const artemisMarks =
    ((sample.match(/\[(name|sel_text)[\s\]]/gi) || []).length) * 3;
  if (cands.some((c) => c.id === "artemis") && artemisMarks >= 3) {
    engine = getEngine("artemis");
  } else if (cands.some((c) => c.id === "reallive") && hashCmd > kagMarks * 2 && hashCmd >= 3) {
    engine = getEngine("reallive");
  } else if (cands.some((c) => c.id === "kirikiri") && kagMarks >= 3) {
    engine = getEngine("kirikiri");
  }
  return { engine, candidates: cands };
}
