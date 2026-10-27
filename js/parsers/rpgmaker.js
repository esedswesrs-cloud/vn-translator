/* Parser RPG Maker MV / MZ (file JSON di www/data/)
 *
 * Sumber teks yang diekstrak:
 * - Event command: 401 (teks dialog), 102 (pilihan), 405 (scrolling text),
 *   320 (ganti nama aktor), 324 (nickname), 325 (profil)
 *   -> 402 (cabang pilihan) otomatis disinkronkan dari 102 agar tidak ganda
 * - Database: Actors, Classes, Skills, Items, Weapons, Armors, Enemies,
 *   States (name/description/message*), System (gameTitle + terms),
 *   MapInfos (nama map)
 * - Map* / CommonEvents / Troops: semua event list
 *
 * Komentar event (108) dan script (355/655) dilewati — itu catatan developer.
 * Rebuild: JSON di-parse, string diganti via path, lalu di-stringify lagi
 * (format spasi asli dipertahankan sebisanya: compact vs pretty).
 */

const RPG_FILES = /^(Map\d+|MapInfos|CommonEvents|Troops|Actors|Classes|Skills|Items|Weapons|Armors|Enemies|States|System)\.json$/i;

export function baseName(p) {
  return String(p || "").split(/[\\/]/).pop();
}

export function looksLikeRpgMaker(data, fileName) {
  const base = baseName(fileName);
  if (RPG_FILES.test(base)) return true;
  if (data && typeof data === "object") {
    if (Array.isArray(data.events)) return true; // Map*.json
    if (data.terms && typeof data.terms === "object") return true; // System.json
    if (
      Array.isArray(data) &&
      data.some(
        (e) =>
          e &&
          typeof e.name === "string" &&
          ("description" in e || "pages" in e || "list" in e || "message1" in e)
      )
    )
      return true;
  }
  return false;
}

function setPath(obj, path, val) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = val;
}

export function parseRpgMaker(text, fileName) {
  const segments = [];
  const warnings = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { segments, warnings: ["File bukan JSON yang valid."] };
  }
  const base = baseName(fileName).replace(/\.json$/i, "");
  let n = 0;
  const push = (kind, label, source, path) => {
    const s = String(source ?? "");
    if (!s.trim()) return null;
    const seg = {
      key: `rpg:${++n}`,
      line: label,
      speaker: "",
      speakerVar: "",
      kind,
      source: s,
      translation: "",
      path: [...path],
      syncPaths: [],
    };
    segments.push(seg);
    return seg;
  };

  /* --- event command list --- */
  const handleList = (list, listPath, labelPrefix) => {
    const pending = []; // pilihan 102 menunggu 402 pasangannya
    list.forEach((cmd, ci) => {
      if (!cmd || typeof cmd.code !== "number") return;
      const p = cmd.parameters || [];
      const at = (extra) => `${labelPrefix} · #${ci + 1}${extra ? " " + extra : ""}`;
      const pp = [...listPath, ci, "parameters"];
      switch (cmd.code) {
        case 401: // teks dialog
          push("dialog", at(), p[0], [...pp, 0]);
          break;
        case 405: // scrolling text
          push("scroll", at(), p[0], [...pp, 0]);
          break;
        case 102: // pilihan
          (p[0] || []).forEach((ch, i) => {
            const seg = push("choice", at(), ch, [...pp, 0, i]);
            if (seg) pending.push({ text: String(ch), seg, used: false });
          });
          break;
        case 402: {
          // cabang pilihan: sinkronkan dari 102, jangan jadi segmen ganda
          const m = pending.find((c) => !c.used && c.text === String(p[1]));
          if (m) {
            m.used = true;
            m.seg.syncPaths.push([...pp, 1]);
          } else {
            push("choice", at(), p[1], [...pp, 1]);
          }
          break;
        }
        case 320: // ganti nama aktor
          push("actor_name", at(), p[1], [...pp, 1]);
          break;
        case 324: // nickname
          push("nickname", at(), p[1], [...pp, 1]);
          break;
        case 325: // profil
          push("profile", at(), p[1], [...pp, 1]);
          break;
        default:
          break; // 101/103/104/105/108/355/dll: bukan teks / dilewati
      }
    });
  };

  const handleEventPages = (pages, pagesPath, labelPrefix) => {
    (pages || []).forEach((pg, pi) => {
      if (pg && Array.isArray(pg.list))
        handleList(pg.list, [...pagesPath, pi, "list"], `${labelPrefix} · hal.${pi + 1}`);
    });
  };

  /* --- routing berdasar nama file --- */
  const low = base.toLowerCase();
  if (/^map\d+$/.test(low)) {
    (data.events || []).forEach((ev, ei) => {
      if (!ev) return;
      handleEventPages(ev.pages, ["events", ei, "pages"], `${base} · Event ${ev.id ?? ei}`);
    });
  } else if (low === "commonevents") {
    (Array.isArray(data) ? data : []).forEach((ce, i) => {
      if (!ce || !Array.isArray(ce.list)) return;
      handleList(ce.list, [i, "list"], `${base} · #${ce.id ?? i}`);
    });
  } else if (low === "troops") {
    (Array.isArray(data) ? data : []).forEach((tr, i) => {
      if (!tr) return;
      handleEventPages(tr.pages, [i, "pages"], `${base} · Troop ${tr.id ?? i}`);
    });
  } else if (low === "system") {
    push("title", `${base} · judul`, data.gameTitle, ["gameTitle"]);
    const terms = data.terms || {};
    (terms.basic || []).forEach((t, i) => push("term", `${base} · basic`, t, ["terms", "basic", i]));
    (terms.commands || []).forEach((t, i) => push("term", `${base} · command`, t, ["terms", "commands", i]));
    (terms.params || []).forEach((t, i) => push("term", `${base} · param`, t, ["terms", "params", i]));
    Object.entries(terms.messages || {}).forEach(([k, v]) =>
      push("term", `${base} · pesan`, v, ["terms", "messages", k])
    );
  } else if (low === "mapinfos") {
    (Array.isArray(data) ? data : []).forEach((m, i) => {
      if (m && m.name) push("mapname", `${base} · #${i}`, m.name, [i, "name"]);
    });
  } else {
    // database generik: Actors, Classes, Skills, Items, Weapons, Armors, Enemies, States
    const FIELDS = ["name", "nickname", "profile", "description", "message1", "message2", "message3", "message4"];
    (Array.isArray(data) ? data : []).forEach((entry, i) => {
      if (!entry) return;
      FIELDS.forEach((f) => {
        if (typeof entry[f] === "string" && entry[f].trim())
          push("db", `${base} · #${entry.id ?? i} · ${f}`, entry[f], [i, f]);
      });
    });
  }

  warnings.push(
    "Komentar event (108) dan script (355/655) dilewati — itu catatan developer, bukan teks game."
  );
  warnings.push(
    "Cabang pilihan (402) otomatis mengikuti terjemahan pilihan (102), jadi tidak perlu diterjemahkan dua kali."
  );

  return { segments, warnings };
}

export function applyRpgMaker(original, segments) {
  const data = JSON.parse(original);
  for (const s of segments) {
    if (s.translation === "" || s.translation == null) continue;
    setPath(data, s.path, s.translation);
    for (const sp of s.syncPaths || []) setPath(data, sp, s.translation);
  }
  const pretty = original.includes("\n");
  return JSON.stringify(data, null, pretty ? 2 : 0);
}

export const RPGMAKER = {
  id: "rpgmaker",
  name: "RPG Maker MV/MZ",
  exts: [".json"],
  status: "supported",
  description: "www/data/*.json: dialog event, pilihan, dan database.",
  parse: parseRpgMaker,
  apply: applyRpgMaker,
};
