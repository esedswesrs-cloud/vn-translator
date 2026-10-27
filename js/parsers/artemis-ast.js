/* Parser Artemis Engine — format AST (.ast, teks Lua).
 * Port dari VNTranslationTools (C#, MIT): LuaParser + ArtemisAstScript.
 * Mendukung astver 1 (default bila tidak ada) dan 2.0.
 * String yang diambil: nama pembicara, teks pilihan, dan pesan (dengan [perintah] inline).
 * Write-back: nilai LuaString diganti langsung, tabel pesan dirakit ulang,
 * lalu seluruh pohon Lua diserialisasi kembali.
 */

/* ---------- node Lua ---------- */
class LuaString {
  constructor(value) { this.value = value; }
  toLua() { return quoteC(this.value); }
}
class LuaNumber {
  constructor(value) { this.value = value; }
  toLua() { return this.value; }
}
class LuaAttribute {
  constructor(name, value) { this.name = name; this.value = value; }
  toLua(indent = 0) {
    const n = /^\d/.test(this.name) ? `[${this.name}]` : this.name;
    return `${n} = ${this.value.toLua(indent)}`;
  }
}
class LuaTable {
  constructor() { this.items = []; }
  add(n) { this.items.push(n); return n; }
  attr(name) {
    const a = this.items.find((i) => i instanceof LuaAttribute && i.name === name);
    return a ? a.value : null;
  }
  toLua(indent = 0) {
    const hasChild = this.items.some(
      (i) => i instanceof LuaTable || (i instanceof LuaAttribute && i.value instanceof LuaTable));
    let s = "{";
    if (hasChild) s += "\n";
    const pad = " ".repeat((indent + 1) * 4);
    this.items.forEach((it, i) => {
      if (hasChild) s += pad;
      s += it.toLua(indent + 1);
      if (i < this.items.length - 1) s += hasChild ? "," : ", ";
      if (hasChild) s += "\n";
    });
    if (hasChild) s += " ".repeat(indent * 4);
    return s + "}";
  }
}

/* ---------- util string gaya-C ---------- */
// Catatan: "\a" bukan escape valid di JS — pakai \x07 dkk secara eksplisit.
const ESC_MAP = { a: "\x07", b: "\x08", f: "\x0c", n: "\n", r: "\r", t: "\t", v: "\x0b", "\\": "\\", "'": "'", '"': '"', "?": "?", "0": "\x00" };
const CTRL_MAP = { "\x07": "a", "\x08": "b", "\x0c": "f", "\n": "n", "\r": "r", "\t": "t", "\x0b": "v" };
function unescapeC(s) {
  return s.replace(/\\(.)/g, (m, c) => (c in ESC_MAP ? ESC_MAP[c] : c));
}
function escapeC(s) {
  return s.replace(/[\x07\x08\x0c\n\r\t\x0b\\]/g, (c) => "\\" + (CTRL_MAP[c] || c));
}
function quoteC(s) {
  return '"' + escapeC(s).replace(/"/g, '\\"') + '"';
}

/* ---------- parser Lua (recursive descent) ---------- */
function skipWs(st) {
  while (st.p < st.s.length && /\s/.test(st.s[st.p])) st.p++;
}
function readNumber(st) {
  const start = st.p;
  while (st.p < st.s.length && /[0-9+\-.]/.test(st.s[st.p])) st.p++;
  return new LuaNumber(st.s.slice(start, st.p));
}
function readQuotedString(st) {
  const quote = st.s[st.p++];
  let raw = "";
  while (st.p < st.s.length) {
    const c = st.s[st.p++];
    if (c === "\\") { raw += c + (st.s[st.p++] ?? ""); }
    else if (c === quote) break;
    else raw += c;
  }
  return new LuaString(unescapeC(raw));
}
function readBracketedString(st) {
  st.p++; // [
  let level = 0;
  while (st.s[st.p] === "=") { level++; st.p++; }
  if (st.s[st.p] !== "[") throw new Error("string Lua tak valid");
  st.p++;
  const start = st.p;
  while (true) {
    if (st.p >= st.s.length) throw new Error("string Lua tak tertutup");
    if (st.s[st.p] === "]") {
      let q = st.p + 1, lv = 0;
      while (st.s[q] === "=") { lv++; q++; }
      if (st.s[q] === "]" && lv === level) {
        const v = st.s.slice(start, st.p);
        st.p = q + 1;
        return new LuaString(v);
      }
    }
    st.p++;
  }
}
function readAttribute(st) {
  let name;
  if (st.s[st.p] === "[") {
    st.p++;
    const key = readNode(st);
    name = key instanceof LuaNumber || key instanceof LuaString ? key.value : null;
    if (name == null) throw new Error("nama atribut Lua tak valid");
    skipWs(st);
    if (st.s[st.p] !== "]") throw new Error('"]" tak ditemukan');
    st.p++;
  } else {
    const start = st.p;
    while (st.p < st.s.length && /[A-Za-z0-9_]/.test(st.s[st.p])) st.p++;
    name = st.s.slice(start, st.p);
  }
  skipWs(st);
  if (st.s[st.p] !== "=") throw new Error('"=" tak ditemukan setelah nama atribut');
  st.p++;
  const value = readNode(st);
  if (!value) throw new Error("atribut tanpa nilai");
  return new LuaAttribute(name, value);
}
function readTable(st) {
  const t = new LuaTable();
  st.p++; // {
  while (true) {
    skipWs(st);
    if (st.p >= st.s.length) throw new Error("tabel Lua tak tertutup");
    if (st.s[st.p] === "}") { st.p++; break; }
    const item = readNode(st);
    if (!item) throw new Error("tabel Lua tak lengkap");
    t.add(item);
    skipWs(st);
    if (st.s[st.p] === ",") st.p++;
  }
  return t;
}
function readNode(st) {
  skipWs(st);
  if (st.p >= st.s.length) return null;
  const c = st.s[st.p];
  if (/[0-9+\-.]/.test(c)) return readNumber(st);
  if (c === '"' || c === "'") return readQuotedString(st);
  if (c === "[" && (st.s[st.p + 1] === "[" || st.s[st.p + 1] === "=")) return readBracketedString(st);
  if (/[A-Za-z_\[]/.test(c)) return readAttribute(st);
  if (c === "{") return readTable(st);
  throw new Error("token Lua tak dikenal pada posisi " + st.p);
}
function parseLua(text) {
  const st = { s: text, p: 0 };
  const nodes = [];
  while (true) {
    const n = readNode(st);
    if (!n) break;
    nodes.push(n);
  }
  return nodes;
}

/* ---------- ekstraksi string (V1 & V2) ---------- */
function findAst(nodes) {
  let astver = null, ast = null;
  for (const n of nodes) {
    if (n instanceof LuaAttribute && n.name === "astver" &&
        (n.value instanceof LuaNumber || n.value instanceof LuaString)) astver = n.value.value;
    if (n instanceof LuaAttribute && n.name === "ast" && n.value instanceof LuaTable) ast = n.value;
  }
  return { astver, ast };
}

// Hasilkan {node, type} — type: "name" | "message". node LuaString atau LuaTable (pesan).
function* stringNodesV1(ast) {
  const texts = ast.attr("text");
  if (!(texts instanceof LuaTable)) return;
  for (const a of texts.items) {
    if (!(a instanceof LuaAttribute)) continue;
    const text = a.value;
    if (!(text instanceof LuaTable)) continue;
    const nameTbl = text.attr("name");
    const nameStr = nameTbl instanceof LuaTable ? nameTbl.attr("name") : null;
    if (nameStr instanceof LuaString) yield { node: nameStr, type: "name" };
    const select = text.attr("select");
    if (select instanceof LuaTable)
      for (const c of select.items) if (c instanceof LuaString) yield { node: c, type: "message" };
    const message = text.items.find((i) => i instanceof LuaTable);
    if (message) yield { node: message, type: "message", isTable: true };
  }
}
function* stringNodesV2(ast) {
  for (const a of ast.items) {
    if (!(a instanceof LuaAttribute)) continue;
    const block = a.value;
    if (!(block instanceof LuaTable)) continue;
    const select = block.attr("select");
    const selJa = select instanceof LuaTable ? select.attr("ja") : null;
    if (selJa instanceof LuaTable)
      for (const c of selJa.items) if (c instanceof LuaString) yield { node: c, type: "message" };
    const text = block.attr("text");
    const textJa = text instanceof LuaTable ? text.attr("ja") : null;
    if (textJa instanceof LuaTable && textJa.items.length === 1) {
      const message = textJa.items[0];
      if (!(message instanceof LuaTable)) continue;
      const names = message.attr("name");
      if (names instanceof LuaTable)
        for (const nm of names.items) if (nm instanceof LuaString) yield { node: nm, type: "name" };
      yield { node: message, type: "message", isTable: true };
    }
  }
}

/* ---------- serialisasi pesan ---------- */
function serializeCommand(table) {
  const parts = ["[" + table.items[0].value];
  for (let i = 1; i < table.items.length; i++) {
    const a = table.items[i];
    parts.push(`${a.name}=${a.value.toLua()}`);
  }
  return parts.join(" ") + "]";
}
function isRt2Table(t) {
  return t instanceof LuaTable && t.items.length === 1 &&
    t.items[0] instanceof LuaString && t.items[0].value === "rt2";
}
function serializeMessage(table) {
  let s = "";
  for (const item of table.items) {
    if (item instanceof LuaString) s += item.value;
    else if (item instanceof LuaTable) {
      if (isRt2Table(item)) s += "\n";
      else s += serializeCommand(item);
    }
  }
  return s.trim();
}
/* Serialisasi untuk DITERJEMAHKAN: perintah game [...] diganti placeholder
 * [ph id=N] agar tidak dirusak mesin penerjemah (kutip berubah, isi
 * diterjemahkan, dsb). Saat apply, placeholder dikembalikan ke tabel
 * perintah ASLI — bukan hasil karangan mesin. */
function serializeMessagePh(table) {
  let s = "", n = 0;
  for (const item of table.items) {
    if (item instanceof LuaString) s += item.value;
    else if (item instanceof LuaTable) {
      if (isRt2Table(item)) s += "\n";
      else s += `[ph id=${n++}]`;
    }
  }
  return s.trim();
}
function cloneLua(n) {
  if (n instanceof LuaString) return new LuaString(n.value);
  if (n instanceof LuaNumber) return new LuaNumber(n.value);
  if (n instanceof LuaAttribute) return new LuaAttribute(n.name, cloneLua(n.value));
  if (n instanceof LuaTable) { const t = new LuaTable(); for (const i of n.items) t.add(cloneLua(i)); return t; }
  throw new Error("node Lua tak dikenal");
}
const CMD_ARG_RE = /(\w+)\s*=\s*("(?:\\.|[^"])*"|[-+\.\d]+)/g;
function deserializeCommand(cmd) {
  const m = /^\[(\/?\w+)((?:\s+\w+\s*=\s*(?:"(?:\\.|[^"])*"|[-+\.\d]+))*)?\]$/.exec(cmd.trim());
  if (!m) throw new Error("gagal parse perintah: " + cmd);
  const t = new LuaTable();
  t.add(new LuaString(m[1]));
  CMD_ARG_RE.lastIndex = 0;
  let am;
  while ((am = CMD_ARG_RE.exec(m[2] || ""))) {
    const v = am[2].startsWith('"') ? new LuaString(unescapeC(am[2].slice(1, -1))) : new LuaNumber(am[2]);
    t.add(new LuaAttribute(am[1], v));
  }
  return t;
}
function rt2Table() {
  const t = new LuaTable();
  t.add(new LuaString("rt2"));
  return t;
}
function deserializeMessage(text, table) {
  // Kumpulkan tabel perintah ASLI (urutannya sama seperti serializeMessagePh) sebelum dirombak.
  const origCmds = table.items.filter((i) => i instanceof LuaTable && !isRt2Table(i));
  table.items = table.items.filter((i) => i instanceof LuaAttribute);
  const parts = text.split(/(\r\n|\[.+?\])/g);
  for (const p of parts) {
    if (!p) continue;
    if (p === "\r\n") { table.add(rt2Table()); continue; }
    if (/^\[.+?\]$/.test(p)) {
      let cmd = null;
      try { cmd = deserializeCommand(p); } catch { /* jadi teks biasa di bawah */ }
      if (cmd && cmd.items[0] instanceof LuaString && cmd.items[0].value === "ph") {
        // Placeholder -> kembalikan tabel perintah ASLI (bukan hasil terjemahan mesin)
        const idAttr = cmd.items.find((i) => i instanceof LuaAttribute && i.name === "id");
        const idx = idAttr && idAttr.value instanceof LuaNumber ? Number(idAttr.value.value) : -1;
        table.add(idx >= 0 && idx < origCmds.length ? cloneLua(origCmds[idx]) : new LuaString(p));
      } else if (cmd) {
        table.add(cmd);
      } else {
        // Perintah dirusak mesin penerjemah (kutip berubah dsb) -> simpan sebagai
        // teks biasa. File tetap jadi ✅, tidak gagal total.
        table.add(new LuaString(p));
      }
      continue;
    }
    table.add(new LuaString(p));
  }
}

function walkStrings(ast, astver) {
  if (astver === "2.0") return stringNodesV2(ast);
  if (astver == null) return stringNodesV1(ast);
  throw new Error(`.ast versi ${astver} belum didukung (baru 1 dan 2.0).`);
}

export function parseArtemisAst(text) {
  const nodes = parseLua(text);
  const { astver, ast } = findAst(nodes);
  if (!ast) throw new Error('Atribut "ast" tidak ditemukan — bukan file .ast Artemis yang valid.');
  const segments = [];
  let i = 0;
  for (const { node, type, isTable } of walkStrings(ast, astver)) {
    const source = isTable ? serializeMessagePh(node) : node.value;
    if (!source || !source.trim()) continue;
    segments.push({
      key: `artemis-ast:S${i++}`, line: -1, speaker: "", speakerVar: "",
      kind: type === "name" ? "name" : "message",
      source, translation: "", start: -1, end: -1,
    });
  }
  return {
    segments,
    warnings: [
      `Format .ast Lua (astver ${astver ?? "1"}). Penanda [ph id=N] adalah perintah game — jangan dihapus/diubah, terjemahkan teks di sekitarnya saja.`,
      "File .asb (biner terkompilasi) belum didukung.",
    ],
  };
}

export function applyArtemisAst(original, segments) {
  const nodes = parseLua(original);
  const { astver, ast } = findAst(nodes);
  if (!ast) throw new Error('Atribut "ast" tidak ditemukan.');
  let si = 0;
  for (const { node, isTable } of walkStrings(ast, astver)) {
    const source = isTable ? serializeMessagePh(node) : node.value;
    if (!source || !source.trim()) continue;
    const seg = segments[si++];
    if (!seg) break;
    if (seg.translation != null && seg.translation !== "") {
      if (isTable) deserializeMessage(seg.translation, node);
      else node.value = seg.translation;
    }
  }
  return nodes.map((n) => n.toLua()).join("\n") + "\n";
}

export const ARTEMIS_AST = {
  id: "artemis-ast",
  name: "Artemis Engine (.ast)",
  exts: [".ast"],
  status: "supported",
  description: "Artemis .ast (Lua). Mendukung astver 1 dan 2.0; .asb biner belum.",
  parse: parseArtemisAst,
  apply: applyArtemisAst,
};
