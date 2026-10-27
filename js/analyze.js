/* Analisis game dari struktur folder (nama path saja, cepat, tanpa baca isi).
 * Menebak engine, lalu memberi panduan: file apa yang di-upload & langkah menerjemahkan.
 * Dipakai di hasil "Pilih Folder" — renderFolderResults(). */

const SIGNS = [
  {
    id: "renpy", tests: [
      { rx: /(^|\/)renpy\//, w: 4, label: "folder renpy/" },
      { rx: /\.rpy$/i, w: 2, cap: 6, label: "file .rpy" },
      { rx: /\.rpyc$/i, w: 1, cap: 3, label: "file .rpyc" },
      { rx: /(^|\/)game\//, w: 1, label: "folder game/" },
    ],
  },
  {
    id: "kirikiri", tests: [
      { rx: /(^|\/)data\.xp3$/i, w: 4, label: "data.xp3" },
      { rx: /\.xp3$/i, w: 2, cap: 6, label: "file .xp3" },
      { rx: /(^|\/)plugin\//, w: 1, label: "folder plugin/" },
      { rx: /\.ks$/i, w: 1, cap: 3, label: "file .ks (tanpa folder tyrano/)" },
    ],
  },
  {
    id: "tyrano", tests: [
      { rx: /(^|\/)tyrano\//, w: 4, label: "folder tyrano/" },
      { rx: /(^|\/)data\/scenario\//, w: 3, label: "folder data/scenario/" },
      { rx: /\.ks$/i, w: 1, cap: 4, label: "file .ks" },
    ],
  },
  {
    id: "rpgmaker", tests: [
      { rx: /(^|\/)www\/data\//, w: 4, label: "folder www/data/" },
      { rx: /game\.rpgproject$/i, w: 4, label: "Game.rpgproject" },
      { rx: /\.rvdata2$/i, w: 3, cap: 6, label: "file .rvdata2 (RPG Maker VX Ace)" },
      { rx: /(^|\/)www\/data\/system\.json$/i, w: 2, label: "www/data/System.json" },
    ],
  },
  {
    id: "yuris", tests: [
      { rx: /\.ypf$/i, w: 3, cap: 6, label: "file .ypf" },
      { rx: /\.ybn$/i, w: 2, cap: 4, label: "file .ybn" },
    ],
  },
  {
    id: "reallive", tests: [
      { rx: /seen\.txt$/i, w: 3, label: "seen.txt" },
      { rx: /(^|\/)g00\//, w: 2, label: "folder G00/" },
    ],
  },
  {
    id: "artemis", tests: [
      { rx: /\.ast$/i, w: 3, cap: 6, label: "file .ast" },
      { rx: /\.asb$/i, w: 2, cap: 4, label: "file .asb" },
      { rx: /\.pfs$/i, w: 2, cap: 4, label: "file .pfs (arsip Artemis)" },
      { rx: /\.iet$/i, w: 2, cap: 4, label: "file .iet" },
    ],
  },
  {
    id: "naninovel", tests: [
      { rx: /\.nani$/i, w: 4, cap: 6, label: "file .nani" },
      { rx: /(^|\/)level0$/i, w: 1, label: "file level0 (Unity)" },
      { rx: /unityplayer\.dll$/i, w: 2, label: "UnityPlayer.dll" },
      { rx: /(^|\/)[^/]*_data\//, w: 1, label: "folder *_Data (Unity)" },
    ],
  },
];

const GUIDES = {
  renpy: {
    upload: "File <span class=\"kbd\">.rpy</span> dari folder <span class=\"kbd\">game/</span> (mis. <span class=\"kbd\">game/script.rpy</span>). Punya <span class=\"kbd\">.rpyc</span> atau <span class=\"kbd\">.rpa</span> saja? Tidak masalah — keduanya terdeteksi otomatis dan bisa di-<strong>proses langsung di web ini</strong>.",
    steps: [
      "Di daftar hasil pindai, klik <strong>Terjemahkan</strong> pada file .rpy — atau <strong>⚡ Terjemahkan semua otomatis</strong> untuk semuanya sekaligus.",
      "Unduh hasilnya, lalu <strong>timpa</strong> file .rpy asli di folder <span class=\"kbd\">game/</span>.",
      "<strong>Hapus</strong> file <span class=\"kbd\">.rpyc</span> pasangannya (mis. <span class=\"kbd\">script.rpyc</span>) agar Ren'Py mengkompilasi ulang.",
      "Jalankan game — terjemahan akan muncul.",
    ],
    notes: ["Punya .rpyc saja? Klik <strong>Decompile</strong> pada grup 🔧 .rpyc di bawah — hasilnya (.rpy) langsung masuk daftar dan bisa diterjemahkan.",
      "Punya .rpa? Klik <strong>Ekstrak →</strong> pada grup 📦 .rpa — script di dalamnya otomatis di-decompile dan masuk daftar.",
      "Mau tambah bahasa baru tanpa menimpa? Pakai <span class=\"kbd\">game/tl/&lt;bahasa&gt;/</span> (buat lewat \"Generate Translations\" di launcher Ren'Py), lalu terjemahkan file di dalamnya."],
  },
  kirikiri: {
    upload: "File <span class=\"kbd\">.ks</span> <strong>hasil ekstrak</strong> dari <span class=\"kbd\">.xp3</span>. Kalau game masih berupa .xp3, ekstrak dulu di PC.",
    steps: [
      "Ekstrak <span class=\"kbd\">data.xp3</span> dengan <strong>GARbro</strong> atau <strong>KrkrExtract</strong> di PC/laptop.",
      "Upload folder hasil ekstrak (atau file .ks-nya) ke sini.",
      "Terjemahkan file .ks, unduh hasilnya.",
      "Masukkan kembali .ks terjemahan ke dalam .xp3 (<em>repack</em>) atau pasang sebagai patch sesuai alat yang dipakai.",
    ],
    notes: ["Kalau .xp3 terenkripsi dan tidak bisa dibuka GARbro, web ini tidak bisa membantu — butuh kunci/skema dari developer game."],
  },
  tyrano: {
    upload: "File <span class=\"kbd\">.ks</span> dari folder <span class=\"kbd\">data/scenario/</span>.",
    steps: [
      "Di daftar hasil pindai, klik <strong>Terjemahkan</strong> pada file .ks — atau <strong>⚡ Terjemahkan semua otomatis</strong>.",
      "Unduh hasilnya, lalu <strong>timpa</strong> file .ks asli di <span class=\"kbd\">data/scenario/</span>.",
      "Jalankan game (browser / TyranoBuilder) — terjemahan akan muncul.",
    ],
    notes: [],
  },
  rpgmaker: {
    upload: "File <span class=\"kbd\">.json</span> dari folder <span class=\"kbd\">www/data/</span> (mis. <span class=\"kbd\">Map001.json</span>, <span class=\"kbd\">CommonEvents.json</span>).",
    steps: [
      "Di daftar hasil pindai, klik <strong>Terjemahkan</strong> pada file JSON — atau <strong>⚡ Terjemahkan semua otomatis</strong>.",
      "<strong>Backup</strong> dulu folder <span class=\"kbd\">www/data/</span> yang asli.",
      "Timpa file JSON asli dengan hasil terjemahan.",
      "Jalankan game — teks akan berubah.",
    ],
    notes: ["RPG Maker VX Ace (<span class=\"kbd\">.rvdata2</span>) belum didukung — hubungi pengembang bila butuh."],
  },
  yuris: {
    upload: "Arsip <span class=\"kbd\">.ypf</span> bisa <strong>langsung</strong> di-upload — web ini bisa membukanya. Atau file <span class=\"kbd\">.ybn</span> hasil ekstrak.",
    steps: [
      "Upload file <span class=\"kbd\">.ypf</span> lewat tombol arsip / daftar arsip di hasil pindai.",
      "Buka dan ekstrak script dari dalam arsip di web ini.",
      "Terjemahkan script-nya, unduh hasilnya.",
    ],
    notes: [],
  },
  reallive: {
    upload: "File script RealLive (<span class=\"kbd\">seen.txt</span> dan sejenisnya).",
    steps: [
      "Di daftar hasil pindai, klik <strong>Terjemahkan</strong> pada file script — atau <strong>⚡ Terjemahkan semua otomatis</strong>.",
      "Unduh hasilnya, lalu timpa file script asli di folder game.",
    ],
    notes: [],
  },
  artemis: {
    upload: "Upload langsung file <span class=\"kbd\">.pfs</span> atau folder hasil ekstrak — script di dalamnya diekstrak otomatis di browser.",
    steps: [
      "Upload file <span class=\"kbd\">.pfs</span> (atau pilih folder game) — klik <strong>Ekstrak →</strong> pada arsipnya.",
      "File <span class=\"kbd\">.ast</span>/<span class=\"kbd\">.txt</span> hasil ekstrak otomatis masuk daftar terjemahan.",
      "Terjemahkan, unduh hasilnya, lalu timpa file asli di folder game.",
    ],
    notes: ["Sebagian game Artemis bisa jalan dengan file lepas (tanpa .pfs) — cukup taruh hasil terjemahan sejajar dengan .pfs-nya."],
  },
  "artemis-ast": {
    upload: "File <span class=\"kbd\">.ast</span> (script Lua Artemis).",
    steps: [
      "Di daftar hasil pindai, klik <strong>Terjemahkan</strong> pada file .ast — atau <strong>⚡ Terjemahkan semua otomatis</strong>.",
      "Unduh hasilnya, lalu timpa file .ast asli di folder game.",
    ],
    notes: ["Perintah [...] di dalam teks jangan dihapus saat menerjemahkan."],
  },
  naninovel: {
    upload: "File <span class=\"kbd\">.nani</span> hasil ekstrak dari game Unity. Kalau game masih berupa AssetBundle, ekstrak dulu di PC.",
    steps: [
      "Ekstrak AssetBundle game Unity dengan <strong>AssetStudio</strong> atau <strong>AssetRipper</strong> di PC/laptop.",
      "Cari file <span class=\"kbd\">.nani</span> di hasil ekstrak, upload ke sini.",
      "Terjemahkan, unduh hasilnya, lalu timpa file .nani asli.",
    ],
    notes: ["Game Unity menyimpan teks di dalam AssetBundle — web ini tidak bisa membukanya langsung, harus diekstrak dulu di PC."],
  },
};

const GENERIC_GUIDE = {
  upload: "File teks script apa pun yang berisi dialog game (<span class=\"kbd\">.rpy</span>, <span class=\"kbd\">.ks</span>, <span class=\"kbd\">.txt</span>, <span class=\"kbd\">.json</span>, …).",
  steps: [
    "Upload file script-nya lewat tombol <strong>Pilih File</strong> — engine akan terdeteksi otomatis per file.",
    "Terjemahkan, unduh hasilnya, lalu timpa file asli di folder game (backup dulu).",
  ],
  notes: ["Struktur folder ini tidak dikenali sebagai salah satu engine yang didukung — kalau tahu nama engine game-nya, beri tahu pengembang."],
};

/* paths: array string rel path. scanRes: { ok:[{engine}], archives:[{kind}] } */
export function analyzeGame(paths, scanRes) {
  const lowers = paths.map((p) => p.toLowerCase());
  const scored = SIGNS.map((s) => {
    let score = 0;
    const hits = [];
    for (const t of s.tests) {
      let n = 0;
      for (const p of lowers) if (t.rx.test(p)) { n++; if (t.cap && n >= t.cap) break; }
      if (n) {
        const add = t.cap ? Math.min(n, t.cap) * t.w : t.w;
        score += add; hits.push(t.label);
      }
    }
    return { id: s.id, score, hits };
  });
  // Bonus: engine yang punya file translatable dari hasil pindai
  if (scanRes && scanRes.ok) {
    const perEng = new Map();
    for (const o of scanRes.ok) perEng.set(o.engine.id, (perEng.get(o.engine.id) || 0) + 1);
    for (const s of scored) {
      const n = perEng.get(s.id) || 0;
      if (n > 0) { s.score += Math.min(n, 5); s.hits.push(`${n} file terdeteksi`); }
    }
    if (scanRes.archives) {
      for (const a of scanRes.archives) {
        const s = scored.find((x) => (a.kind === "xp3" && x.id === "kirikiri") || (a.kind === "ypf" && x.id === "yuris"));
        if (s) { s.score += 2; s.hits.push(`arsip .${a.kind}`); }
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const confidence = best.score >= 6 ? "tinggi" : best.score >= 3 ? "sedang" : "rendah";
  const guide = best.score >= 3 ? GUIDES[best.id] : GENERIC_GUIDE;
  return { best, scored, confidence, guide, known: best.score >= 3 };
}

export function analysisCardHTML(a, engineName) {
  const g = a.guide;
  const confBadge = a.known
    ? `<span class="muted">(keyakinan ${a.confidence})</span>`
    : `<span class="muted">(tidak dikenali)</span>`;
  const title = a.known
    ? `🎮 Engine terdeteksi: <strong>${engineName}</strong> ${confBadge}`
    : `🎮 Engine tidak dikenali ${confBadge}`;
  const steps = g.steps.map((s, i) => `<li>${s}</li>`).join("");
  const notes = (g.notes || []).map((n) => `<div class="notice" style="margin-top:8px">💡 ${n}</div>`).join("");
  const signals = a.known && a.best.hits.length
    ? `<div class="muted" style="font-size:12px;margin-top:4px">Dasar: ${a.best.hits.slice(0, 5).join(" · ")}</div>`
    : "";
  return `<div class="card" style="border:1px solid var(--brand)">
    <h3 style="margin:0 0 6px;font-size:15px">🔍 Analisis Game</h3>
    <div>${title}</div>${signals}
    <div style="margin-top:8px"><strong>📤 File yang perlu di-upload:</strong><br>${g.upload}</div>
    <div style="margin-top:8px"><strong>📋 Cara menerjemahkan:</strong><ol style="margin:4px 0;padding-left:20px">${steps}</ol></div>
    ${notes}</div>`;
}
