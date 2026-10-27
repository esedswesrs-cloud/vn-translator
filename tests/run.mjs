/* Uji round-trip parser: parse -> terjemahan dummy -> rebuild -> verifikasi */
import { readFileSync } from "fs";
import { parseRenpy, applyRenpy } from "../js/parsers/renpy.js";
import { parseKirikiri, applyKirikiri } from "../js/parsers/kirikiri.js";
import { parseRealLive, applyRealLive } from "../js/parsers/reallive.js";
import { parseTyrano, applyTyrano } from "../js/parsers/tyrano.js";
import { parseRpgMaker, applyRpgMaker } from "../js/parsers/rpgmaker.js";
import { parseYpf, crc32, adler32, murmurhash2 } from "../js/parsers/ypf.js";
import { parseXp3 } from "../js/parsers/xp3.js";
import { parseYsc, parseYstb, rebuildYstb, wordToText, textToWord, splitSpeaker, joinSpeaker } from "../js/parsers/yuris.js";
import { parseArtemis, applyArtemis } from "../js/parsers/artemis.js";
import { parseArtemisAst, applyArtemisAst } from "../js/parsers/artemis-ast.js";
import { parseNaninovel, applyNaninovel } from "../js/parsers/naninovel.js";
import { openPfs } from "../js/parsers/pfs.js";
import { detectEngine, ENGINES } from "../js/engines.js";
import { scanFolder, FOLDER_TEXT_LIMIT } from "../js/folder.js";
import { getProvider as getMtProvider, translateBatch, GEMINI_MODELS, GEMINI_MODEL_ALIAS } from "../js/mt.js";
import { inflateSync } from "node:zlib";

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? "  PASS " : "  FAIL ") + msg);
  if (!cond) failures++;
}

function dummyTranslate(segs) {
  // Terjemahan dummy: bungkus dengan [ID]...[/ID], jaga tag KAG [...]
  return segs.map((s) => ({ ...s, translation: "[ID]" + s.source + "[/ID]" }));
}

console.log("== Ren'Py ==");
{
  const text = readFileSync(new URL("./samples/sample.rpy", import.meta.url), "utf8");
  const { segments, warnings } = parseRenpy(text);
  console.log("  segmen:", segments.length, "| warnings:", warnings.length);
  ok(segments.length === 7, `7 segmen dialog/narasi/pilihan (dapat ${segments.length})`);
  ok(segments[0].speaker === "Eileen", "nama pembicara ter-resolve via define Character");
  ok(segments[0].source === "Kamu sudah membuat game baru!", "teks dialog benar");
  ok(segments.some((s) => s.kind === "choice" && s.source === "Jalan Eileen"), "pilihan menu terdeteksi");
  ok(!segments.some((s) => s.source.includes("Hello") || s.source.includes("Halo")), "blok old/new dilewati");
  ok(segments[2].source.includes('"halo"'), "escaped quote ter-handle");

  const out = applyRenpy(text, dummyTranslate(segments));
  ok(out.includes('define e = Character("Eileen")'), "define tidak rusak");
  ok(out.includes('e "[ID]Kamu sudah membuat game baru![/ID]"'), "dialog diterjemahkan dalam kutip");
  ok(out.includes('"[ID]Jalan Eileen[/ID]":'), "pilihan menu titik dua tetap ada");
  ok(out.includes("# Ini komentar"), "komentar utuh");
  ok((out.match(/"/g) || []).length % 2 === 0, "kutip tetap seimbang");
}

console.log("== Ren'Py: deteksi duplikat old ==");
{
  const dup = [
    'translate english strings:',
    '    old "Halo dunia"',
    '    new "Hello world"',
    "",
    '    old "Halo dunia"',
    '    new "Hello world lagi"',
    "",
    "label start:",
    '    e "Hai"',
  ].join("\n");
  const { warnings } = parseRenpy(dup);
  ok(warnings.some((w) => w.includes("Duplikat") && w.includes("baris 5") && w.includes("baris 2")),
    "duplikat old terdeteksi dengan nomor baris");
  const okText = [
    'translate english strings:',
    '    old "Satu"',
    '    new "One"',
    '    old "Dua"',
    '    new "Two"',
  ].join("\n");
  ok(parseRenpy(okText).warnings.length === 0, "tidak ada warning untuk old yang unik");
  // beda bahasa tidak dianggap duplikat
  const diffLang = [
    "translate english strings:",
    '    old "Sama"',
    '    new "Same"',
    "translate indonesian strings:",
    '    old "Sama"',
    '    new "Sama"',
  ].join("\n");
  ok(parseRenpy(diffLang).warnings.length === 0, "old sama beda bahasa bukan duplikat");
}

console.log("== Kirikiri ==");
{
  const text = readFileSync(new URL("./samples/sample.ks", import.meta.url), "utf8");
  const { segments, warnings } = parseKirikiri(text);
  console.log("  segmen:", segments.length, "| warnings:", warnings.length);
  ok(segments.length === 4, `4 baris pesan (dapat ${segments.length})`);
  ok(segments[0].source === "Selamat datang di dunia Kirikiri![p]", "baris pesan + tag inline");
  const out = applyKirikiri(text, dummyTranslate(segments));
  ok(out.includes("[ID]Selamat datang di dunia Kirikiri![p][/ID]"), "tag inline [p] lestari di dalam terjemahan");
  ok(out.includes("[ruby text="), "tag ruby di baris asli tetap ada di output");
  ok(out.includes("; Komentar KAG"), "komentar utuh");
  ok(out.includes("*start|Halaman awal"), "label utuh");
  ok(out.includes('@bg storage="bg01.jpg"'), "macro utuh");
  ok(out.split("\n").length === text.split("\n").length, "jumlah baris sama");
}

console.log("== RealLive ==");
{
  const text = readFileSync(new URL("./samples/sample_reallive.txt", import.meta.url), "utf8");
  const { segments } = parseRealLive(text);
  console.log("  segmen:", segments.length);
  ok(segments.length === 4, `4 baris teks (dapat ${segments.length})`);
  ok(!segments.some((s) => s.source.startsWith("#")), "baris # dilewati");
  const out = applyRealLive(text, dummyTranslate(segments));
  ok(out.includes("#seendsp 0"), "perintah # utuh");
  ok(out.includes("[ID]「おはようございます」[/ID]"), "dialog 「」 diterjemahkan");
  ok(out.split("\n").length === text.split("\n").length, "jumlah baris sama");
}

console.log("== TyranoScript ==");
{
  const text = readFileSync(new URL("./samples/sample_tyranoscript.ks", import.meta.url), "utf8");
  const { segments, warnings } = parseTyrano(text);
  console.log("  segmen:", segments.length, "| warnings:", warnings.length);
  ok(segments.length === 5, `5 segmen (2 nama + 3 pesan) (dapat ${segments.length})`);
  const names = segments.filter((s) => s.kind === "name");
  ok(names.length === 2 && names[0].source === "Yuko" && names[1].source === "Takeshi", "nama pembicara diekstrak dari baris #");
  const msgs = segments.filter((s) => s.kind === "message");
  ok(msgs[0].speaker === "Yuko" && msgs[1].speaker === "Takeshi" && msgs[2].speaker === "Takeshi",
     "pembicara menempel pada pesan berikutnya");
  ok(!segments.some((s) => s.source.includes("bukan_nama")), "blok [iscript] dilewati");
  const out = applyTyrano(text, dummyTranslate(segments));
  ok(out.includes("#[ID]Yuko[/ID]"), "nama diterjemahkan, prefix # lestari");
  ok(out.includes("[ID]こんにちは、元気？[p][/ID]"), "pesan + tag [p] lestari");
  ok(out.includes('[chara_show name="yuko" left="200"]'), "tag chara_show utuh (ID tak diubah)");
  ok(out.includes("var x = "), "isi iscript utuh");
  ok(out.split("\n").length === text.split("\n").length, "jumlah baris sama");
}

console.log("== RPG Maker MV/MZ ==");
{
  const mapText = readFileSync(new URL("./samples/sample_map.json", import.meta.url), "utf8");
  const { segments, warnings } = parseRpgMaker(mapText, "Map001.json");
  console.log("  segmen map:", segments.length, "| warnings:", warnings.length);
  // 2x401 dialog + 3 pilihan(102) + 1x401 + 1x405 scroll + 1x320 nama = 8
  // (402 tidak jadi segmen ganda, komentar 108 dilewati)
  ok(segments.length === 8, `8 segmen map (dapat ${segments.length})`);
  ok(segments[0].source === "Halo, selamat datang di desa kami!", "teks 401 benar");
  ok(segments[2].kind === "choice" && segments[2].source === "Beli", "pilihan 102 benar");
  ok(!segments.some((s) => s.source.includes("catatan developer")), "komentar 108 dilewati");
  const out = applyRpgMaker(mapText, dummyTranslate(segments));
  const back = JSON.parse(out); // tetap JSON valid
  const list = back.events[1].pages[0].list;
  ok(list[1].parameters[0] === "[ID]Halo, selamat datang di desa kami![/ID]", "401 diterjemahkan");
  ok(list[3].parameters[0][0] === "[ID]Beli[/ID]", "pilihan 102 diterjemahkan");
  ok(list[4].parameters[1] === "[ID]Beli[/ID]", "cabang 402 tersinkron dari 102");
  ok(list[7].parameters[0] === "catatan developer, lewati", "komentar utuh");
  ok(list[11].parameters[1] === "[ID]Pahlawan[/ID]", "ganti nama aktor (320)");

  const actText = readFileSync(new URL("./samples/sample_actors.json", import.meta.url), "utf8");
  const a = parseRpgMaker(actText, "Actors.json");
  ok(a.segments.length === 4, `4 segmen actors (string kosong dilewati) (dapat ${a.segments.length})`);
  const aOut = JSON.parse(applyRpgMaker(actText, dummyTranslate(a.segments)));
  ok(aOut[1].nickname === "[ID]Si Pemberani[/ID]", "nickname database");

  const sysText = readFileSync(new URL("./samples/sample_system.json", import.meta.url), "utf8");
  const s = parseRpgMaker(sysText, "System.json");
  ok(s.segments.some((x) => x.source === "Fantasy Journey"), "gameTitle terekstrak");
  const sOut = JSON.parse(applyRpgMaker(sysText, dummyTranslate(s.segments)));
  ok(sOut.terms.messages.alwaysDash === "[ID]Always Dash[/ID]", "terms.messages");
}

console.log("== YPF (YU-RIS) ==");
{
  // sanity hash (vektor umum)
  ok(crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "crc32 benar");
  ok(adler32(new TextEncoder().encode("123456789")) === 0x091e01de, "adler32 benar");
  ok(murmurhash2(new TextEncoder().encode(""), 0) === 0, "murmurhash2 string kosong");

  const inflate = async (u8) => new Uint8Array(inflateSync(u8));
  for (const [fn, ver, n] of [["v255.ypf", 255, 103], ["v494.ypf", 494, 143]]) {
    const buf = readFileSync(new URL(`./samples/yuris/${fn}`, import.meta.url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ypf = await parseYpf(ab, { inflate });
    ok(ypf.version === ver, `${fn}: versi ${ver}`);
    ok(ypf.files.length === n, `${fn}: ${n} file (dapat ${ypf.files.length})`);
    const ysc = ypf.files.find((f) => f.name.endsWith("ysc.ybn"));
    ok(!!ysc, `${fn}: ysc.ybn ketemu`);
    ok(new TextDecoder("latin1").decode(ysc.data.slice(0, 4)) === "YSCM", `${fn}: magic ysc.ybn valid`);
    const total = ypf.files.reduce((a, f) => a + f.size, 0);
    ok(total > 100000, `${fn}: total ${total} byte terekstrak`);
  }
  // file rusak harus ditolak
  const bad = new Uint8Array([1, 2, 3, 4]).buffer;
  let threw = false;
  try { await parseYpf(bad); } catch { threw = true; }
  ok(threw, "file bukan YPF ditolak");

  // rebuild round-trip dengan file asli (v255: crc32/adler32, v494: murmurhash2).
  // parseYpf memverifikasi nameHash & fileHash — parse ulang yang sukses
  // membuktikan hash hasil rebuild benar.
  const { rebuildYpf } = await import("../js/parsers/ypf.js");
  for (const fn of ["v255.ypf", "v494.ypf"]) {
    const buf = readFileSync(new URL(`./samples/yuris/${fn}`, import.meta.url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const orig = await parseYpf(ab, { inflate });
    const victim = orig.files.find((f) => f.name.endsWith(".ybn")) || orig.files[0];
    const newData = new TextEncoder().encode("data pengganti untuk uji rebuild — 12345");
    const rebuilt = await rebuildYpf(ab, new Map([[victim.name, newData]]), { inflate });
    const chk = await parseYpf(rebuilt, { inflate });
    ok(chk.files.length === orig.files.length, `${fn} rebuild: jumlah file tetap`);
    ok(chk.version === orig.version, `${fn} rebuild: versi tetap`);
    const cf = chk.files.find((f) => f.name === victim.name);
    ok(cf && Buffer.from(cf.data).equals(Buffer.from(newData)), `${fn} rebuild: file pengganti benar`);
    const other = chk.files.find((f) => f.name !== victim.name);
    const oo = orig.files.find((f) => f.name === other.name);
    ok(other && Buffer.from(other.data).equals(Buffer.from(oo.data)), `${fn} rebuild: file lain utuh`);
  }
}

console.log("== XP3 (Kirikiri) ==");
{
  const inflate = async (u8) => new Uint8Array(inflateSync(u8));
  const buf = readFileSync(new URL("./samples/xp3/test1.xp3", import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const xp3 = await parseXp3(ab, { inflate });
  ok(xp3.files.length === 5, `5 file (dapat ${xp3.files.length})`);
  const names = xp3.files.map((f) => f.name).sort();
  ok(names.includes("scenario/first.ks") && names.includes("scenario/second.ks"), "path bersarang kebaca");
  const ks = xp3.files.find((f) => f.name === "scenario/first.ks");
  const txt = new TextDecoder().decode(ks.data);
  ok(txt.startsWith("Hello XP3 world!") && ks.size === 850, "isi file terkompresi benar");
  const empty = xp3.files.find((f) => f.name === "empty.txt");
  ok(empty && empty.size === 0, "file kosong");
  const bin = xp3.files.find((f) => f.name === "data.bin");
  ok(bin && bin.size === 100000, "file biner tak terkompresi");
  let threw = false;
  try { await parseXp3(new Uint8Array([1, 2, 3]).buffer); } catch { threw = true; }
  ok(threw, "file bukan XP3 ditolak");

  // rebuild round-trip dengan file asli
  const { rebuildXp3 } = await import("../js/parsers/xp3.js");
  const newKs = new TextEncoder().encode("; terjemahan uji\nhello dunia");
  const rebuiltX = await rebuildXp3(ab, new Map([["scenario/first.ks", newKs]]), { inflate });
  const chkX = await parseXp3(rebuiltX, { inflate });
  ok(chkX.files.length === xp3.files.length, "rebuild XP3: jumlah file tetap");
  const cfX = chkX.files.find((f) => f.name === "scenario/first.ks");
  ok(cfX && Buffer.from(cfX.data).toString() === "; terjemahan uji\nhello dunia", "rebuild XP3: file pengganti benar");
  const binX = chkX.files.find((f) => f.name === "data.bin");
  ok(binX && binX.size === 100000 && binX.data[0] === xp3.files.find((f) => f.name === "data.bin").data[0], "rebuild XP3: file lain utuh");
}

console.log("== YU-RIS script (.ybn) ==");
{
  const inflate = async (u8) => new Uint8Array(inflateSync(u8));
  const buf = readFileSync(new URL("./samples/yuris/v494.ypf", import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const ypf = await parseYpf(ab, { inflate });
  const byname = {};
  ypf.files.forEach((f) => { byname[f.name.split("\\").pop()] = f.data; });

  const ysc = parseYsc(byname["ysc.ybn"]);
  ok(ysc.wordCode >= 0, `WORD code ketemu (${ysc.wordCode})`);
  ok(ysc.special.ifCode >= 0 && ysc.special.loopCode >= 0, "kode IF/LOOP ketemu");

  // kode kontrol
  const sjisDec = new TextDecoder("shift-jis");
  const raw = new Uint8Array([0x82, 0xa0, 0xef, 0xf0, 0x82, 0xa2, 0xef, 0xf2]); // あ\nい\p
  const t = wordToText(raw);
  ok(t === sjisDec.decode(new Uint8Array([0x82, 0xa0])) + "\n" + sjisDec.decode(new Uint8Array([0x82, 0xa2])) + "\x01", "kontrol 0xEF F0/F2");
  const asciiEnc = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  const back = textToWord("A\nB\\pC", asciiEnc);
  ok(back.join(",") === "65,239,240,66,239,242,67", "textToWord konversi kontrol");

  // speaker split
  const sp = splitSpeaker("太郎「こんにちは」");
  ok(sp.speaker === "太郎" && sp.text === "こんにちは" && sp.bracket === "kagikakko", "split speaker 「」");
  ok(joinSpeaker(sp.speaker, "hi", sp.bracket) === "太郎「hi」", "join speaker");

  // round-trip di semua file yst
  let n = 0, okRt = 0, okTr = 0, words = 0;
  for (const [name, d] of Object.entries(byname)) {
    if (!/^yst\d+\.ybn$/.test(name)) continue;
    n++;
    const p = parseYstb(new Uint8Array(d), ysc.special);
    words += p.words.length;
    const rt = rebuildYstb(p, new Map(), asciiEnc);
    if (Buffer.from(rt).equals(Buffer.from(d))) okRt++;
    else console.log("  RT FAIL:", name);
    const m = new Map(p.words.map((w) => [w.key, "X"]));
    const rt2 = rebuildYstb(p, m, asciiEnc);
    const p2 = parseYstb(rt2, ysc.special);
    if (p2.words.length === p.words.length && p2.words.every((w) => w.text === "X")) okTr++;
    else console.log("  TR FAIL:", name);
  }
  ok(n > 100, `${n} file yst diproses`);
  ok(okRt === n, `round-trip byte-identical ${okRt}/${n}`);
  ok(okTr === n, `rebuild terjemahan valid ${okTr}/${n}`);
  ok(words > 400, `${words} string WORD terekstrak`);
}

console.log("== Artemis TXT ==");
{
  const text = readFileSync(new URL("./samples/sample_artemis.txt", import.meta.url), "utf8");
  const { segments } = parseArtemis(text);
  ok(segments.length === 6, `6 segmen (dapat ${segments.length})`);
  ok(segments[0].kind === "name" && segments[0].source === "Saki", "nama [name] terdeteksi");
  ok(segments[1].kind === "message" && segments[1].source.includes("Apa kabar"), "paragraf jadi 1 segmen");
  ok(segments[4].kind === "choice" && segments[4].source === "Pergi keluar", "teks [sel_text] terdeteksi");
  // round-trip dengan terjemahan tanpa kurung siku (nama satu kata, spt referensi)
  const tr = ["SakiID", "Halo ID.\nApa kabar ID?", "RenID", "Baik ID.", "Pergi ID", "Tetap ID"];
  segments.forEach((s, i) => { s.translation = tr[i]; });
  const back = applyArtemis(text, segments);
  ok(back.includes("[name SakiID]") && back.includes('[sel_text text="Pergi ID"]'), "perintah tidak rusak");
  const re = parseArtemis(back);
  ok(re.segments.length === 6 && re.segments.every((s, i) => s.source === tr[i]), "round-trip Artemis TXT");
}

console.log("== Artemis AST ==");
{
  const v1 = readFileSync(new URL("./samples/sample_artemis_v1.ast", import.meta.url), "utf8");
  const r1 = parseArtemisAst(v1);
  ok(r1.segments.length === 6, `V1: 6 segmen (dapat ${r1.segments.length})`);
  ok(r1.segments[0].kind === "name" && r1.segments[0].source === "Saki", "V1: nama terdeteksi");
  ok(r1.segments[1].source === "Halo, apa kabar?[ph id=0]", `V1: perintah jadi placeholder (dapat ${r1.segments[1].source})`);
  const t1 = ["Saki ID", "Halo ID? [ph id=0]", "Ren ID", "Pergi ID", "Tetap ID", "Baik ID."];
  r1.segments.forEach((s, i) => { s.translation = t1[i]; });
  const back1 = applyArtemisAst(v1, r1.segments);
  const r1b = parseArtemisAst(back1);
  ok(r1b.segments.every((s, i) => s.source === t1[i]), "round-trip AST V1");
  ok(back1.includes('{"r"}'), "perintah asli [r] dipertahankan byte-per-byte");
  ok(back1.includes('name = "Saki ID"'), "serialisasi Lua valid");

  const v2 = readFileSync(new URL("./samples/sample_artemis_v2.ast", import.meta.url), "utf8");
  const r2 = parseArtemisAst(v2);
  ok(r2.segments.length === 5, `V2: 5 segmen (dapat ${r2.segments.length})`);
  ok(r2.segments[2].kind === "name" && r2.segments[2].source === "Yuki", "V2: nama terdeteksi");
  const t2 = ["Ya ID", "Tidak ID", "Yuki ID", "Pagi ID.", "Cerah ID."];
  r2.segments.forEach((s, i) => { s.translation = t2[i]; });
  const back2 = applyArtemisAst(v2, r2.segments);
  const r2b = parseArtemisAst(back2);
  ok(r2b.segments.every((s, i) => s.source === t2[i]), "round-trip AST V2");
}

console.log("== Artemis AST: perintah ruby + MT merusak ==");
{
  // Regresi bug 2026-10-06: file dengan [ruby text="..."] gagal total ("gagal parse
  // perintah") saat diterjemahkan dari daftar, karena MT merusak isi perintah.
  const vRuby = 'ast = {\n    text = {\n        [0] = {\n            name = { name = "Saki" },\n            { "Halo", { "ruby", text = "ひ" }, "dunia" },\n        },\n    },\n}';
  const r = parseArtemisAst(vRuby);
  const msg = r.segments.find((s) => s.kind === "message");
  ok(msg && msg.source === "Halo[ph id=0]dunia", `ruby jadi placeholder (dapat ${msg && msg.source})`);
  // MT ideal: placeholder dipertahankan -> perintah asli kembali utuh
  msg.translation = "Halo ID[ph id=0]dunia ID";
  const back = applyArtemisAst(vRuby, r.segments);
  ok(back.includes('text = "ひ"'), "perintah ruby asli dipertahankan byte-per-byte");
  ok(back.includes("Halo ID") && back.includes("dunia ID"), "terjemahan masuk");
  // MT merusak: kutip lurus jadi kutip keriting -> dulu meledak, kini jadi teks biasa
  const r2 = parseArtemisAst(vRuby);
  const m2 = r2.segments.find((s) => s.kind === "message");
  m2.translation = "Halo ID[ruby text=\u201cひ\u201d]dunia ID";
  let threw = false, back2 = "";
  try { back2 = applyArtemisAst(vRuby, r2.segments); } catch { threw = true; }
  ok(!threw, "perintah rusak MT tidak menggagalkan file");
  ok(back2.includes("Halo ID"), "hasil terjemahan tetap tersimpan");
  // MT menghapus placeholder -> perintah hilang tapi file tetap jadi
  const r3 = parseArtemisAst(vRuby);
  const m3 = r3.segments.find((s) => s.kind === "message");
  m3.translation = "Halo ID dunia ID";
  let threw3 = false;
  try { applyArtemisAst(vRuby, r3.segments); } catch { threw3 = true; }
  ok(!threw3, "placeholder hilang tidak menggagalkan file");
}

console.log("== Naninovel ==");
{
  const text = readFileSync(new URL("./samples/sample_naninovel.nani", import.meta.url), "utf8");
  const { segments } = parseNaninovel(text);
  ok(segments.length === 5, `5 segmen (dapat ${segments.length})`);
  ok(segments[0].speaker === "Saki" && segments[0].source === "Halo, selamat datang.", "dialog + pembicara");
  ok(segments[1].speaker === "" && segments[1].source === "Narasi biasa di sini.", "narasi");
  ok(segments[2].kind === "choice" && segments[2].source === "Pergi keluar", "@choice terdeteksi");
  const tr = ["Halo ID.", "Narasi ID.", "Pergi ID.", "Tetap ID.", "Keluar ID."];
  segments.forEach((s, i) => { s.translation = tr[i]; });
  const back = applyNaninovel(text, segments);
  ok(back.includes('Saki: Halo ID.') && back.includes('@choice "Pergi ID."'), "kutip @choice utuh");
  const re = parseNaninovel(back);
  ok(re.segments.every((s, i) => s.source === tr[i]), "round-trip Naninovel");
}

console.log("== Ekstraksi arsip (PFS/RPA) ==");
{
  // Bangun arsip PF8 sintetis: 1 file .ast terenkripsi + 1 file .mp4 mentah
  const { createHash } = await import("node:crypto");
  function buildPf8(files) {
    const enc = new TextEncoder();
    const head = Buffer.alloc(11);
    head.write("pf8", 0);
    head.writeUInt32LE(files.length, 7);
    const metas = files.map(([name, content]) => {
      const nb = Buffer.from(enc.encode(name + "\0"));
      const eb = Buffer.alloc(4 + nb.length + 4 + 8);
      eb.writeUInt32LE(nb.length, 0);
      nb.copy(eb, 4);
      return { eb, nameLen: nb.length, content: Buffer.from(content), name };
    });
    const idxSize = 4 + metas.reduce((a, m) => a + m.eb.length, 0);
    let dataOff = 11 + (idxSize - 4);
    for (const m of metas) {
      const base = 4 + m.nameLen + 4; // posisi offset di dalam eb
      m.eb.writeUInt32LE(dataOff, base);
      m.eb.writeUInt32LE(m.content.length, base + 4);
      dataOff += m.content.length;
    }
    const fullIndex = Buffer.concat([Buffer.from(head.subarray(7, 11)), ...metas.map((m) => m.eb)]);
    const key = createHash("sha1").update(fullIndex).digest();
    head.writeUInt32LE(fullIndex.length, 3);
    const out = [Buffer.from(head), ...metas.map((m) => m.eb)];
    for (const m of metas) {
      let d = m.content;
      if (!/\.(mp4|flv)$/i.test(m.name)) {
        const x = Buffer.alloc(d.length);
        for (let j = 0; j < d.length; j++) x[j] = d[j] ^ key[j % key.length];
        d = x;
      }
      out.push(d);
    }
    return Buffer.concat(out);
  }
  const astText = 'ast = { text = { [0] = { { "Halo." } } } }\n';
  const pfsBuf = buildPf8([
    ["script/main.ast", Buffer.from(astText)],
    ["movie/op.mp4", Buffer.from([1, 2, 3, 4])],
  ]);
  const pfs = await openPfs(pfsBuf);
  ok(pfs.format === "pf8", "PF8 terdeteksi");
  ok(pfs.entries.length === 2, `2 entri (dapat ${pfs.entries.length})`);
  ok(pfs.entries[0].name === "script/main.ast", "nama Shift-JIS terbaca");
  const d0 = pfs.getData(0);
  ok(Buffer.from(d0).toString() === astText, "data .ast terdekripsi benar");
  const d1 = pfs.getData(1);
  ok(d1[0] === 1 && d1.length === 4, ".mp4 tidak di-XOR");
  // parse hasilnya sebagai Artemis AST
  const { parseArtemisAst } = await import("../js/parsers/artemis-ast.js");
  const r = parseArtemisAst(Buffer.from(d0).toString());
  ok(r.segments.length === 1 && r.segments[0].source === "Halo.", "isi .ast hasil ekstrak terparse");

  // PF6 (tanpa enkripsi)
  const pf6head = Buffer.from(pfsBuf);
  pf6head.write("pf6", 0);
  const pfs6 = await openPfs(pf6head);
  ok(pfs6.format === "pf6", "PF6 terdeteksi");

  // file rusak ditolak
  let err = "";
  try { await openPfs(new Uint8Array([1, 2, 3])); } catch (e) { err = e.message; }
  ok(/terlalu kecil|magic/.test(err), "PFS rusak ditolak");

  // rebuild: ganti 1 file -> arsip baru terbaca, pengganti & file lain benar
  const { rebuildPfs } = await import("../js/parsers/pfs.js");
  const rebuilt = await rebuildPfs(pfsBuf, new Map([["script/main.ast", new TextEncoder().encode("konten baru yang lebih panjang")]]));
  const pfs2 = await openPfs(rebuilt);
  ok(pfs2.entries.length === 2, "rebuild: jumlah entri tetap 2");
  ok(pfs2.entries[0].name === "script/main.ast" && pfs2.entries[1].name === "movie/op.mp4", "rebuild: nama & urutan entri tetap");
  ok(Buffer.from(pfs2.getData(0)).toString() === "konten baru yang lebih panjang", "rebuild: file pengganti terdekripsi benar");
  ok(pfs2.getData(1)[0] === 1 && pfs2.getData(1).length === 4, "rebuild: file lain utuh");
  const rebuiltSame = await rebuildPfs(pfsBuf, new Map());
  const pfs3 = await openPfs(rebuiltSame);
  ok(Buffer.from(pfs3.getData(0)).toString() === astText, "rebuild tanpa penggantian: data asli utuh");

  // .rpa tidak valid ditolak dengan pesan ramah
  const { listRpaScripts } = await import("../js/extract.js");
  let rerr = "";
  try { await listRpaScripts(new Uint8Array([1, 2, 3, 4])); } catch (e) { rerr = e.message; }
  ok(/Gagal membuka/.test(rerr), ".rpa rusak ditolak ramah");

  // .rpa sintetis (RPA-3.0 asli) -> daftar + baca isi
  const rpaBuf = readFileSync(new URL("./samples/sample.rpa", import.meta.url));
  const rpaItems = await listRpaScripts(rpaBuf);
  ok(rpaItems.length === 1 && rpaItems[0].path === "game/test.rpy", ".rpa: entri script terdaftar");
  const { readRpaScript } = await import("../js/extract.js");
  const rpaRead = await readRpaScript(rpaItems[0]);
  ok(rpaRead.kind === "rpy" && rpaRead.text.includes("Halo dari RPA"), ".rpa: isi script terbaca");
}

console.log("== Deteksi engine ==");
{
  const rpy = readFileSync(new URL("./samples/sample.rpy", import.meta.url), "utf8");
  ok(detectEngine("game.rpy", rpy).engine.id === "renpy", "rpy -> renpy");
  const ks = readFileSync(new URL("./samples/sample.ks", import.meta.url), "utf8");
  ok(detectEngine("scenario.ks", ks).engine.id === "kirikiri", "ks KAG -> kirikiri");
  const ty = readFileSync(new URL("./samples/sample_tyranoscript.ks", import.meta.url), "utf8");
  const dty = detectEngine("scene1.ks", ty);
  ok(dty.engine.id === "tyrano", `ks TyranoScript -> tyrano (dapat ${dty.engine.id})`);
  ok(dty.candidates.length === 2, "ks ambigu menawarkan 2 kandidat");
  const rl = readFileSync(new URL("./samples/sample_reallive.txt", import.meta.url), "utf8");
  const d = detectEngine("Seen.txt", rl);
  ok(d.engine.id === "reallive", `txt berisi # -> reallive (dapat ${d.engine.id})`);
  ok(d.candidates.length === 3, "txt ambigu menawarkan 3 kandidat");
  const atx = readFileSync(new URL("./samples/sample_artemis.txt", import.meta.url), "utf8");
  const datx = detectEngine("scenario.txt", atx);
  ok(datx.engine.id === "artemis", `txt Artemis -> artemis (dapat ${datx.engine.id})`);
  const ast = readFileSync(new URL("./samples/sample_artemis_v1.ast", import.meta.url), "utf8");
  ok(detectEngine("main.ast", ast).engine.id === "artemis-ast", "ast -> artemis-ast");
  const nn = readFileSync(new URL("./samples/sample_naninovel.nani", import.meta.url), "utf8");
  ok(detectEngine("Start.nani", nn).engine.id === "naninovel", "nani -> naninovel");
  ok(detectEngine("x.ybn", "bin").engine === null, "format tak dikenal -> null");
  const mapJ = readFileSync(new URL("./samples/sample_map.json", import.meta.url), "utf8");
  ok(detectEngine("Map001.json", mapJ).engine.id === "rpgmaker", "Map001.json -> rpgmaker");
  ok(detectEngine("Actors.json", readFileSync(new URL("./samples/sample_actors.json", import.meta.url), "utf8")).engine.id === "rpgmaker", "Actors.json -> rpgmaker");
  ok(detectEngine("notes.json", '{"a":1}').engine === null, "json acak -> null");
  ok(ENGINES.length === 29, `29 engine terdaftar (dapat ${ENGINES.length})`);
  ok(ENGINES.filter((e) => e.status === "supported").length === 11, "11 engine didukung penuh");
}

console.log("== Pindai folder ==");
{
  ok(FOLDER_TEXT_LIMIT === 8 * 1024 * 1024, "batas teks folder 8 MB");
  // decodeBuffer: salinan murni dari js/app.js (tanpa DOM)
  async function decodeBuffer(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      return { text: new TextDecoder("utf-8").decode(bytes.slice(3)), encoding: "utf-8-sig" };
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
      return { text: new TextDecoder("utf-16le").decode(bytes.slice(2)), encoding: "utf-16le" };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }; }
    catch { return { text: new TextDecoder("shift-jis").decode(bytes), encoding: "shift-jis" }; }
  }
  const cases = [
    ["mygame/scenario/a.ks", "a.ks"],
    ["mygame/scenario/b.ks", "b.ks"],
    ["mygame/game/c.rpy", "c.rpy"],
    ["mygame/d.txt", "d.txt"],
    ["mygame/www/data/Map001.json", "Map001.json"],
    ["mygame/empty.rpy", "empty.rpy"],
    ["mygame/img/g.png", "g.png"],
    ["mygame/scenario/h.scn", "h.scn"],
    ["mygame/scenario/i.ks", "i.ks"],
    ["mygame/scenario/j.ks", "j.ks"],
    ["mygame/k.ybn", "k.ybn"],
    ["mygame/data.xp3", "data.xp3"],
    ["mygame/m.xyz", "m.xyz"],
    ["mygame/script.rpyc", "n.rpyc"],
    ["mygame/archive.rpa", "o.rpa"],
  ];
  const files = cases.map(([rel, fn]) => {
    const buf = readFileSync(new URL("./samples/folder/" + fn, import.meta.url));
    return {
      name: rel.split("/").pop(),
      size: buf.length,
      webkitRelativePath: rel,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  });
  let prog = null;
  const res = await scanFolder(files, { decodeBuffer }, (d, t) => { prog = [d, t]; });
  ok(prog && prog[0] === files.length && prog[1] === files.length, "progress mencapai total");
  const engines = res.ok.map((o) => o.engine.id).sort();
  ok(res.ok.length === 5, `5 file terdeteksi bisa diterjemahkan (dapat ${res.ok.length})`);
  ok(JSON.stringify(engines) === JSON.stringify(["kirikiri", "reallive", "renpy", "rpgmaker", "tyrano"]), `engine terdeteksi tepat: ${engines.join(",")}`);
  ok(res.ok.every((o) => o.path.startsWith("mygame/")), "path relatif folder dipertahankan");
  ok(res.archives.length === 1 && res.archives[0].kind === "xp3", "data.xp3 masuk grup arsip");
  const skipReason = {};
  for (const s of res.skipped) skipReason[s.path] = s.reason;
  ok(res.skipped.length === 7, `7 file dilewati (dapat ${res.skipped.length})`);
  ok(skipReason["mygame/empty.rpy"] === "tidak ada teks untuk diterjemahkan", "rpy tanpa dialog -> dilewati");
  ok(skipReason["mygame/img/g.png"] === "file media/biner", "png -> dilewati via ekstensi");
  ok(skipReason["mygame/scenario/h.scn"] === "file biner/terkompilasi", "scn biner -> dilewati via heuristik");
  ok(skipReason["mygame/scenario/i.ks"] === "file kosong", "file kosong -> dilewati");
  ok(skipReason["mygame/scenario/j.ks"] === "terlalu besar (>8 MB)", "file >8MB -> dilewati");
  ok(skipReason["mygame/k.ybn"] === "script YU-RIS — buka lewat arsip .ypf", ".ybn diarahkan ke .ypf");
  ok(skipReason["mygame/m.xyz"] === "format tidak dikenal", "ekstensi asing -> dilewati");
  ok(!skipReason["mygame/script.rpyc"], ".rpyc tidak lagi dilewati");
  ok(res.rpyc.length === 1 && res.rpyc[0].path === "mygame/script.rpyc", ".rpyc masuk grup decompile");
  ok(res.rpa.length === 1 && res.rpa[0].path === "mygame/archive.rpa", ".rpa masuk grup ekstrak (bisa dibuka di web)");
  ok(!skipReason["mygame/archive.rpa"], ".rpa tidak lagi dilewati");
}

console.log("== Gemini MT ==");
{
  const p = getMtProvider("gemini");
  ok(p && p.needsKey === true, "provider gemini terdaftar & butuh key");
  ok(Array.isArray(GEMINI_MODELS) && GEMINI_MODELS.some((m) => m.id === "gemini-3.1-pro-preview"), "daftar model berisi Pro");
  ok(GEMINI_MODEL_ALIAS["gemini-2.0-flash"] === "gemini-3.5-flash", "model lama 2.0-flash dimigrasi ke 3.5-flash");
  ok(GEMINI_MODEL_ALIAS["gemini-2.5-pro"] === "gemini-3.1-pro-preview", "model lama 2.5-pro dimigrasi otomatis");
  let err = "";
  try {
    await translateBatch({ providerId: "gemini", apiKey: "", sourceLang: "ja", targetLang: "id", texts: ["x"] });
  } catch (e) { err = e.message; }
  ok(err.includes("Isi dulu"), "tanpa key -> pesan ramah");

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "1. Halo\n2. Apa kabar\n3. [tag]Baik[/tag]" }] } }],
      }),
    };
  };
  try {
    const out = await translateBatch({
      providerId: "gemini", apiKey: "AIzaTEST", sourceLang: "ja", targetLang: "id",
      texts: ["こんにちは", "元気ですか", "[tag]元気です[/tag]"],
    });
    ok(out.length === 3, "3 baris kembali berurutan");
    ok(out[0] === "Halo" && out[1] === "Apa kabar", "parsing baris bernomor benar");
    ok(out[2] === "[tag]Baik[/tag]", "tag dipertahankan");
    ok(calls[0].url.includes("gemini-3.5-flash:generateContent"), "endpoint model benar");
    ok(calls[0].url.includes("key=AIzaTEST"), "key dikirim via query");
    ok(calls[0].body.contents[0].parts[0].text.includes("1. こんにちは"), "prompt berisi baris bernomor");
    ok(calls[0].body.systemInstruction.parts[0].text.includes("Japanese"), "system instruction benar");
  } finally {
    globalThis.fetch = realFetch;
  }

  // error 429 -> pesan ramah
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => "quota" });
  try {
    let e2 = "";
    try {
      await translateBatch({ providerId: "gemini", apiKey: "AIzaTEST", sourceLang: "ja", targetLang: "id", texts: ["x"] });
    } catch (e) { e2 = e.message; }
    ok(e2.includes("429"), "429 -> pesan limit ramah");
  } finally {
    globalThis.fetch = realFetch;
  }

  // pilihan model pro -> dipakai di URL
  globalThis.fetch = async (url) => {
    calls.push({ url });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "1. X" }] } }] }) };
  };
  try {
    await translateBatch({ providerId: "gemini", apiKey: "AIzaTEST", model: "gemini-3.1-pro-preview", sourceLang: "ja", targetLang: "id", texts: ["x"] });
    ok(calls[calls.length - 1].url.includes("gemini-3.1-pro-preview:generateContent"), "model pro dipakai di URL");
    // model lama otomatis dipetakan ke baru
    await translateBatch({ providerId: "gemini", apiKey: "AIzaTEST", model: "gemini-2.0-flash", sourceLang: "ja", targetLang: "id", texts: ["x"] });
    ok(calls[calls.length - 1].url.includes("gemini-3.5-flash:generateContent"), "model lama dialihkan ke 3.5-flash");
  } finally {
    globalThis.fetch = realFetch;
  }

  // fallback otomatis: model utama 503 -> pindah ke model berikut
  {
    const fbCalls = [];
    globalThis.fetch = async (url) => {
      fbCalls.push(url);
      if (url.includes("gemini-3.8-flash:")) return { ok: false, status: 503, text: async () => "overloaded" };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "1. Halo" }] } }] }) };
    };
    try {
      let fbNote = "";
      const out = await translateBatch({
        providerId: "gemini", apiKey: "AIzaTEST", model: "gemini-3.8-flash",
        sourceLang: "ja", targetLang: "id", texts: ["x"],
        onModelFallback: (from, to) => { fbNote = `${from}->${to}`; },
      });
      ok(out[0] === "Halo", "fallback tetap menghasilkan terjemahan");
      ok(fbCalls[0].includes("gemini-3.8-flash:") && fbCalls[1].includes("gemini-3.5-flash:"), "503 -> coba model berikutnya");
      ok(fbNote === "gemini-3.8-flash->gemini-3.5-flash", "callback fallback dipanggil");
    } finally {
      globalThis.fetch = realFetch;
    }
  }
}

console.log("== Provider OpenAI-compatible (Groq/DeepSeek/OpenAI) ==");
{
  const g = getMtProvider("groq");
  ok(g && g.oai && g.oai.baseUrl === "https://api.groq.com/openai/v1", "groq terdaftar (OpenAI-compatible)");
  ok(g.oai.model === "openai/gpt-oss-120b", "model default groq = openai/gpt-oss-120b (llama-3.3-70b-versatile dimatikan Groq 16 Agu 2026)");
  ok(g.oai.bodyExtra && g.oai.bodyExtra.reasoning_effort === "low" && g.oai.bodyExtra.include_reasoning === false, "groq: reasoning effort rendah & reasoning tidak dikembalikan");
  const d = getMtProvider("deepseek");
  ok(d && d.oai && d.oai.baseUrl === "https://api.deepseek.com", "deepseek terdaftar");
  ok(d.oai.model === "deepseek-flash", "model default deepseek = deepseek-flash (deepseek-v4-flash retired per docs resmi)");
  ok(d.oai.bodyExtra && d.oai.bodyExtra.thinking && d.oai.bodyExtra.thinking.type === "disabled", "deepseek: thinking dimatikan (default V4.1-Flash = aktif, boros token untuk terjemahan)");
  const o = getMtProvider("openai");
  ok(o && o.oai && o.oai.baseUrl === "https://api.openai.com/v1", "openai terdaftar");
  ok(o.oai.model === "gpt-4o-mini", "model default openai = gpt-4o-mini (termurah)");

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "1. Halo\n2. Apa kabar\n3. [ph id=0]Baik" } }] }),
    };
  };
  try {
    const out = await translateBatch({
      providerId: "groq", apiKey: "gsk_TEST", sourceLang: "ja", targetLang: "id",
      texts: ["こんにちは", "元気ですか", "[ph id=0]元気です"],
    });
    ok(out.length === 3 && out[0] === "Halo" && out[1] === "Apa kabar", "groq: 3 baris kembali berurutan");
    ok(out[2] === "[ph id=0]Baik", "groq: placeholder dipertahankan");
    ok(calls[0].url === "https://api.groq.com/openai/v1/chat/completions", "groq: endpoint benar");
    ok(calls[0].headers.Authorization === "Bearer gsk_TEST", "groq: auth Bearer");
    ok(calls[0].body.model === "openai/gpt-oss-120b", "groq: model benar");
    ok(calls[0].body.reasoning_effort === "low" && calls[0].body.include_reasoning === false, "groq: body memakai reasoning low tanpa reasoning balikan");
    ok(!("thinking" in calls[0].body), "groq: body tanpa field thinking (khusus deepseek)");
    ok(calls[0].body.messages[1].content.includes("1. こんにちは"), "groq: prompt berisi baris bernomor");

    // deepseek: model kanonis baru + thinking mati di body request
    calls.length = 0;
    const outDs = await translateBatch({
      providerId: "deepseek", apiKey: "sk_TEST", sourceLang: "ja", targetLang: "id",
      texts: ["こんにちは"],
    });
    ok(outDs[0] === "Halo", "deepseek: hasil kembali");
    ok(calls[0].url === "https://api.deepseek.com/chat/completions", "deepseek: endpoint benar");
    ok(calls[0].body.model === "deepseek-flash", "deepseek: body memakai deepseek-flash");
    ok(calls[0].body.thinking && calls[0].body.thinking.type === "disabled", "deepseek: body mematikan thinking");

    // tanpa key -> pesan ramah
    let err = "";
    try {
      await translateBatch({ providerId: "deepseek", apiKey: "", sourceLang: "ja", targetLang: "id", texts: ["x"] });
    } catch (e) { err = e.message; }
    ok(err.includes("Isi dulu"), "deepseek tanpa key -> pesan ramah");

    // 401 -> pesan ramah
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "invalid key" });
    let e401 = "";
    try {
      await translateBatch({ providerId: "openai", apiKey: "sk-BAD", sourceLang: "ja", targetLang: "id", texts: ["x"] });
    } catch (e) { e401 = e.message; }
    ok(e401.includes("401"), "openai 401 -> pesan key ditolak");

    // model dimatikan penyedia -> pesan jelas, bukan error mentah
    globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => '{"error":{"code":"model_decommissioned","message":"The model has been decommissioned"}}' });
    let eDec = "";
    try {
      await translateBatch({ providerId: "groq", apiKey: "gsk_TEST", sourceLang: "ja", targetLang: "id", texts: ["x"] });
    } catch (e) { eDec = e.message; }
    ok(eDec.includes("dimatikan penyedia"), "model decommissioned -> pesan jelas model dimatikan");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("== Poles via provider non-Gemini ==");
{
  const { proofreadBatch: pb } = await import("../js/mt.js");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "1. Halo dunia\n2. Apa kabar?" } }] }),
    };
  };
  try {
    const groq = getMtProvider("groq");
    const out = await pb({
      providerId: "groq", oai: groq.oai, apiKey: "gsk_TEST",
      targetLang: "id", texts: ["Halo dunia", "Apa kabar?"],
    });
    ok(out.length === 2 && out[0] === "Halo dunia", "poles via groq: hasil kembali berurutan");
    ok(calls[0].url === "https://api.groq.com/openai/v1/chat/completions", "poles via groq: endpoint benar");
    ok(calls[0].body.messages[1].content.includes("Proofread"), "poles via groq: prompt proofread");
    ok(calls[0].body.messages[1].content.includes("exactly 2 numbered lines"), "poles via groq: instruksi jumlah baris tegas");

    // baris yang dilewati model -> dipertahankan aslinya (tidak gagal)
    let dsProofBody = null;
    globalThis.fetch = async (url, opts) => {
      dsProofBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "1. Halo dunia" } }] }),
      };
    };
    const out2 = await pb({
      providerId: "deepseek", oai: getMtProvider("deepseek").oai, apiKey: "sk_TEST",
      targetLang: "id", texts: ["Halo dunia", "Baris kedua"],
    });
    ok(out2[1] === "Baris kedua", "baris dilewati model -> aslinya dipertahankan");
    ok(dsProofBody && dsProofBody.model === "deepseek-flash", "poles deepseek: model deepseek-flash");
    ok(dsProofBody && dsProofBody.thinking && dsProofBody.thinking.type === "disabled", "poles deepseek: thinking dimatikan juga");

    // tanpa key -> pesan ramah
    let err = "";
    try {
      await pb({ providerId: "openai", oai: getMtProvider("openai").oai, apiKey: "", targetLang: "id", texts: ["x"] });
    } catch (e) { err = e.message; }
    ok(err.includes("Isi dulu"), "poles tanpa key -> pesan ramah");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("== Claude via worker proxy ==");
{
  const c = getMtProvider("claude");
  ok(c && c.claude && c.claude.model === "claude-haiku-4-5", "claude terdaftar (via worker)");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "1. Halo\n2. Apa kabar" }] }),
    };
  };
  try {
    const out = await translateBatch({ providerId: "claude", apiKey: "sk-ant_TEST", sourceLang: "ja", targetLang: "id", texts: ["こんにちは", "元気ですか"] });
    ok(out.length === 2 && out[0] === "Halo", "claude: terjemahan kembali berurutan");
    ok(calls[0].url === "https://deepl.arvanity.my.id", "claude: lewat worker proxy");
    ok(calls[0].body.service === "claude", "claude: service flag benar");
    ok(calls[0].body.key === "sk-ant_TEST", "claude: key diteruskan");
    ok(calls[0].body.model === "claude-haiku-4-5", "claude: model benar");
    ok(calls[0].body.messages[0].content.includes("Translate each numbered"), "claude: prompt translate");
    ok(calls[0].body.system.includes("translator"), "claude: system prompt translate");

    const { proofreadBatch: pb2 } = await import("../js/mt.js");
    const pout = await pb2({ providerId: "claude", apiKey: "sk-ant_TEST", targetLang: "id", texts: ["Halo"] });
    ok(pout.length === 1, "claude: proofread routing bekerja");
    ok(calls[1].body.messages[0].content.includes("Proofread"), "claude: prompt proofread");
    ok(calls[1].body.messages[0].content.includes("exactly 1 numbered lines"), "claude: instruksi jumlah baris tegas");

    // 401 dari worker -> pesan ramah
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "invalid x-api-key" } }) });
    let err = "";
    try { await translateBatch({ providerId: "claude", apiKey: "sk-ant_BAD", sourceLang: "ja", targetLang: "id", texts: ["x"] }); }
    catch (e) { err = e.message; }
    ok(err.includes("401"), "claude 401 -> pesan key ditolak");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("== MyMemory + email (limit 10x) ==");
{
  const p = getMtProvider("mymemory");
  ok(p && p.optionalKey === true, "mymemory mendukung email opsional");
  const realFetch = globalThis.fetch;
  let seenUrl = "";
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "Halo" } }) };
  };
  try {
    const out = await translateBatch({
      providerId: "mymemory", apiKey: "user@mail.com",
      sourceLang: "en", targetLang: "id", texts: ["Hello"],
    });
    ok(out[0] === "Halo", "terjemahan kembali");
    ok(seenUrl.includes("de=user%40mail.com"), "email dikirim sebagai param de");
  } finally {
    globalThis.fetch = realFetch;
  }
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  try {
    let msg = "";
    try {
      await translateBatch({ providerId: "mymemory", sourceLang: "en", targetLang: "id", texts: ["x"] });
    } catch (e) { msg = e.message; }
    ok(msg.includes("429") && msg.includes("email"), "429 -> sarankan isi email");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("== Batch ZIP (parse->MT mock->apply->ZIP) ==");{
  const { createRequire } = await import("module");
  const vmMod = await import("vm");
  const src = readFileSync(new URL("../js/vendor/jszip.min.js", import.meta.url), "utf8");
  const sandbox = { setTimeout, clearTimeout, setImmediate };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vmMod.createContext(sandbox);
  vmMod.runInContext(src, sandbox);
  const JSZip = sandbox.JSZip;
  ok(typeof JSZip === "function", "JSZip termuat di sandbox");

  async function decodeBuffer(buf) {
    const bytes = new Uint8Array(buf);
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }; }
    catch { return { text: new TextDecoder("shift-jis").decode(bytes), encoding: "shift-jis" }; }
  }
  const realFetch = globalThis.fetch;
  // mock: jawab sejumlah baris bernomor yang diminta
  globalThis.fetch = async (url, opts) => {
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    const n = (prompt.match(/^\d+\.\s/gm) || []).length;
    const text = Array.from({ length: n }, (_, i) => `${i + 1}. [ID]T${i + 1}[/ID]`).join("\n");
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
  try {
    const { detectEngine } = await import("../js/engines.js");
    const zip = new JSZip();
    const batchCases = [
      ["mygame/scenario/a.ks", "a.ks", "kirikiri"],
      ["mygame/scenario/b.ks", "b.ks", "tyrano"],
      ["mygame/game/c.rpy", "c.rpy", "renpy"],
      ["mygame/d.txt", "d.txt", "reallive"],
      ["mygame/www/data/Map001.json", "Map001.json", "rpgmaker"],
    ];
    const seenEngines = new Set();
    for (const [rel, fn, wantEngine] of batchCases) {
      const raw = readFileSync(new URL("./samples/folder/" + fn, import.meta.url));
      const { text } = await decodeBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const { engine } = detectEngine(rel, text);
      ok(engine.id === wantEngine, `batch: ${rel} -> ${wantEngine}`);
      seenEngines.add(engine.id);
      const { segments } = engine.parse(text, rel);
      const todo = segments.filter((s) => s.source && s.source.trim());
      // pakai translateBatch asli (dengan fetch mock) seperti alur batch di app.js
      const { translateBatch: tb } = await import("../js/mt.js");
      const out = await tb({ providerId: "gemini", apiKey: "AIzaTEST", sourceLang: "ja", targetLang: "id", texts: todo.map((s) => s.source) });
      todo.forEach((s, k) => { s.translation = out[k]; });
      const applied = engine.apply(text, segments);
      // di browser dikirim sebagai Uint8Array (hasil encodeForDownload); di tes string cukup
      // karena beda realm — struktur ZIP yang diuji
      zip.file(rel, applied);
    }
    const buf = await zip.generateAsync({ type: "uint8array" });
    ok(buf.length > 500, `ZIP terbentuk (${buf.length} byte)`);
    const back = await new JSZip().loadAsync(buf);
    const names = Object.keys(back.files).filter((n) => !back.files[n].dir).sort();
    ok(names.length === 5 && seenEngines.size === 5, "5 file / 5 engine masuk ZIP");
    ok(names.includes("mygame/www/data/Map001.json"), "path bersarang dipertahankan di ZIP");
    const c1 = await back.files["mygame/scenario/a.ks"].async("string");
    ok(c1.includes("[ID]"), "hasil terjemahan masuk ke file ZIP");
    const cj = await back.files["mygame/www/data/Map001.json"].async("string");
    ok(cj.includes("[ID]"), "JSON RPG Maker ikut diterjemahkan di ZIP");
    try { JSON.parse(cj); ok(true, "JSON hasil batch tetap valid"); }
    catch { ok(false, "JSON hasil batch tetap valid"); }
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("== Lab XP3: kunci dari .exe ==");
{
  const lab = await import("../js/parsers/xp3crypto.js");
  const { buildXp3, parseXp3 } = await import("../js/parsers/xp3.js");
  const enc = new TextEncoder();

  // --- 1) extractExeStrings: ASCII + UTF-16LE + decoy ---
  const parts = [];
  parts.push(enc.encode("MZ\x90\x00This program cannot be run in DOS mode.\r\n"));
  parts.push(enc.encode("SuperSecretKey99")); // kunci asli (ASCII)
  parts.push(enc.encode("\x00\xff\x00kernel32.dll\x00GetProcAddress\x00"));
  const wide = new Uint8Array("WidePass42".length * 2); // UTF-16LE
  for (let k = 0; k < "WidePass42".length; k++) {
    wide[k * 2] = "WidePass42".charCodeAt(k); wide[k * 2 + 1] = 0;
  }
  parts.push(wide);
  parts.push(enc.encode("Copyright (C) 2024 Test\x00\x00abc")); // "abc" < minLen -> diabaikan
  const fakeExe = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let po = 0;
  for (const p of parts) { fakeExe.set(p, po); po += p.length; }

  const strs = lab.extractExeStrings(fakeExe);
  ok(strs.includes("SuperSecretKey99"), "string ASCII kunci terekstrak dari .exe");
  ok(strs.includes("WidePass42"), "string UTF-16LE terekstrak dari .exe");
  ok(strs.includes("kernel32.dll"), "string decoy ikut terekstrak");
  ok(!strs.includes("abc"), "string < 4 char diabaikan");
  ok(strs.length > 0 && strs.length <= 3000, `jumlah kandidat wajar (${strs.length})`);
  ok(new Set(strs).size === strs.length, "kandidat unik (tidak duplikat)");

  // --- 2) arsip XP3 sintetis: 1 .ks terenkripsi XOR berulang ---
  // sampel .ks = ASCII + pasangan SJIS valid (あいう = 82A0 82A2 82A4)
  const ksBytes = [];
  const pushAscii = (s) => { for (const ch of s) ksBytes.push(ch.charCodeAt(0)); };
  pushAscii("; test script\n*start\n[bg storage=\"bg01\"]\n");
  const aiu = [0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4];
  for (let r = 0; r < 40; r++) ksBytes.push(...aiu, 0x0a);
  pushAscii("[wait time=500]\n");
  const plain = new Uint8Array(ksBytes);
  const keyStr = "SuperSecretKey99";
  const keyBytes = enc.encode(keyStr);
  const cipher = new Uint8Array(plain.length);
  for (let k = 0; k < plain.length; k++) cipher[k] = plain[k] ^ keyBytes[k % keyBytes.length];

  const built = buildXp3([{ name: "scenario/main.ks", data: cipher }]);
  const dv = new DataView(built.buffer); // tandai entri sebagai terenkripsi
  const idxOff = Number(dv.getBigUint64(0x0b, true));
  const flagsOff = idxOff + 9 + 4 + 8 + 4 + 8; // "File"+size -> "info"+size -> u32 flags
  dv.setUint32(flagsOff, dv.getUint32(flagsOff, true) | 0x80000000, true);
  const xp3buf = built.slice().buffer;

  // --- 3) crackExeKeys menemukan kunci dari .exe ---
  const { candidates, results } = await lab.crackExeKeys(xp3buf, "scenario/main.ks", fakeExe);
  ok(candidates > 0, `kandidat dicoba (${candidates})`);
  ok(results.length > 0 && results[0].keyString === keyStr,
    `kunci "${keyStr}" ditemukan (dapat: ${results.length ? results[0].keyString : "-"})`);
  ok(results.length > 0 && results[0].score >= 0.9,
    `skor meyakinkan (${results.length ? (results[0].score * 100).toFixed(0) : 0}%)`);

  // --- 4) round-trip: hook dekripsi memulihkan plaintext ---
  const decrypt = await lab.makeDecryptorForResult(xp3buf, results[0]);
  const { files } = await parseXp3(xp3buf, { decrypt });
  ok(files.length === 1 && files[0].name === "scenario/main.ks", "arsip terbuka dengan hook dekripsi");
  const back = files[0].data;
  ok(back.length === plain.length && back.every((b, k) => b === plain[k]), "data pulih byte-per-byte");

  // --- 5) negatif: .exe tanpa kunci -> tidak ada false positive ---
  const noKeyExe = enc.encode("MZThis program cannot be run in DOS mode.\x00nothing here\x00");
  const neg = await lab.crackExeKeys(xp3buf, "scenario/main.ks", noKeyExe);
  ok(neg.results.length === 0, "tanpa kunci di .exe -> tidak ada false positive");
}

console.log(failures === 0 ? "\nSEMUA TES LOLOS" : `\n${failures} TES GAGAL`);
process.exit(failures === 0 ? 0 : 1);
