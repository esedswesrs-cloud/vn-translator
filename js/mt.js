/* Penyedia mesin penerjemah.
 * - DeepL API Free: butuh API key gratis (https://www.deepl.com/pro-api),
 *   500rb karakter/bulan. Endpoint: https://api-free.deepl.com/v2/translate
 * - Google Gemini: butuh API key gratis (https://aistudio.google.com/apikey),
 *   limit di tier gratis. Model default: gemini-3.5-flash (fallback otomatis ke flash-lite).
 * - MyMemory: tanpa key, limit harian ketat. Cocok untuk coba-coba.
 * - LibreTranslate: endpoint publik/konfigurasi sendiri.
 * - Groq: key GRATIS tanpa kartu kredit (https://console.groq.com/keys),
 *   30 request/menit. OpenAI-compatible, dipanggil langsung dari browser (ada CORS).
 * - DeepSeek: sangat murah, pay-per-token (https://platform.deepseek.com/).
 * - OpenAI/ChatGPT: pay-per-token, butuh billing (https://platform.openai.com/).
 * - Claude (Anthropic): via worker proxy (CORS tidak stabil dari browser),
 *   model claude-haiku-4-5, pay-as-you-go (~$1/1jt token input).
 * Semua key disimpan di localStorage milik pengguna (tidak dikirim ke mana pun
 * selain penyedia yang dipilih).
 */

export const MT_PROVIDERS = [
  {
    id: "deepl",
    name: "DeepL (Free)",
    needsKey: true,
    keyLabel: "DeepL API Free key",
    keyPlaceholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx",
    keyUrl: "https://www.deepl.com/pro-api",
    keyUrlLabel: "Daftar gratis & ambil key DeepL →",
    help: "Paket Developer gratis: 1.000.000 karakter total (tidak reset bulanan), tanpa kartu kredit.",
  },
  {
    id: "gemini",
    name: "Google Gemini (key gratis)",
    needsKey: true,
    keyLabel: "Gemini API key",
    keyPlaceholder: "AIza...",
    keyUrl: "https://aistudio.google.com/apikey",
    keyUrlLabel: "Buat key gratis di AI Studio →",
    help: "Key gratis dari Google AI Studio (tanpa kartu kredit). Tier gratis dibatasi ~15 request/menit — web otomatis memberi jeda.",
  },
  {
    id: "mymemory",
    name: "MyMemory (gratis)",
    needsKey: false,
    optionalKey: true,
    keyLabel: "Email (opsional)",
    keyPlaceholder: "email kamu — limit naik 5rb → 50rb karakter/hari",
    help: "Gratis. Tanpa email: ~5.000 karakter/hari. Isi email: ~50.000 karakter/hari.",
  },
  {
    id: "libretranslate",
    name: "LibreTranslate",
    needsKey: false,
    optionalKey: true,
    keyLabel: "API key (gratis)",
    keyPlaceholder: "key dari portal.libretranslate.com — 100rb karakter/bulan",
    keyUrl: "https://portal.libretranslate.com",
    keyUrlLabel: "Daftar gratis & ambil key →",
    customEndpoint: true,
    endpointLabel: "URL endpoint LibreTranslate",
    endpointPlaceholder: "https://libretranslate.com/translate",
    help: "Key gratis: 100.000 karakter/bulan, tanpa kartu kredit. Catatan: Jepang→Indonesia diterjemahkan lewat Inggris dulu, jadi kualitas di bawah DeepL/Gemini.",
  },
  {
    id: "groq",
    name: "Groq (gratis, cepat)",
    needsKey: true,
    keyLabel: "Groq API key",
    keyPlaceholder: "gsk_...",
    keyUrl: "https://console.groq.com/keys",
    keyUrlLabel: "Buat key gratis di Groq →",
    oai: {
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      gapMs: 2500, // free tier: 30 request/menit
      bodyExtra: { reasoning_effort: "low", include_reasoning: false }, // model reasoning: effort rendah agar hemat kuota token & cepat; reasoning tidak dikembalikan
    },
    help: "GRATIS tanpa kartu kredit (30 request/menit + batas 200rb token/hari di tier gratis). Sangat cepat (~500 token/detik). Model lama llama-3.3-70b-versatile sudah dimatikan Groq (16 Agu 2026) — kini memakai GPT-OSS 120B. Kualitas Jepang→Indonesia di bawah Gemini/DeepL — cocok untuk draf awal.",
  },
  {
    id: "deepseek",
    name: "DeepSeek (sangat murah)",
    needsKey: true,
    keyLabel: "DeepSeek API key",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyUrlLabel: "Buat key di DeepSeek →",
    oai: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      gapMs: 1200,
      bodyExtra: { thinking: { type: "disabled" } }, // model V4.1-Flash: thinking aktif secara default — dimatikan agar terjemahan cepat, hemat token, dan temperature berlaku
    },
    help: "Berbayar per token tapi SANGAT murah (~$0.15/1jt token input & $0.60/1jt output di luar jam sibuk; jam sibuk 2× lipat — 44 file VN tetap sekitar $0.2–0.5). Top-up saldo dulu di platform.deepseek.com. Praktis unlimited.",
  },
  {
    id: "openai",
    name: "OpenAI / ChatGPT",
    needsKey: true,
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "Buat key di OpenAI →",
    oai: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      gapMs: 1200,
    },
    help: "Berbayar pay-as-you-go (gpt-4o-mini ~$0.15/1jt token input — 44 file VN sekitar $0.1–0.2). Butuh billing aktif di OpenAI.",
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    needsKey: true,
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/",
    keyUrlLabel: "Buat key di Anthropic Console →",
    claude: {
      model: "claude-haiku-4-5",
      gapMs: 2000,
    },
    help: "Kualitas sastra terbaik untuk Jepang→Indonesia. Via worker proxy (key hanya lewat, tidak disimpan). Berbayar pay-as-you-go (Haiku ~$1/1jt token input); akun baru dapat kredit gratis awal. Catatan: langganan Claude Pro TIDAK termasuk kuota API.",
  },
];

export function getProvider(id) {
  return MT_PROVIDERS.find((p) => p.id === id);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Pacer adaptif antar-request: cegah 429 sebelum terjadi.
 * Tiap penyedia punya jeda sendiri: mulai 0; tiap 429 → +2 dtk (maks 10 dtk);
 * tiap 10 sukses beruntun → -0,5 dtk. "Lambat tapi mulus" jauh lebih cepat
 * daripada pola ngebut-lalu-jeda-60-detik. */
const __pace = {};
function __paceSt(key) { return __pace[key] || (__pace[key] = { delay: 0, ok: 0 }); }
async function paceBefore(key) {
  const st = __paceSt(key);
  if (st.delay > 0) await sleep(st.delay);
}
function paceAfterOk(key) {
  const st = __paceSt(key);
  if (++st.ok >= 10 && st.delay > 0) { st.delay = Math.max(0, st.delay - 500); st.ok = 0; }
}
function paceOn429(key) {
  const st = __paceSt(key);
  st.ok = 0;
  st.delay = Math.min(st.delay + 2000, 10000);
}

/* Fetch dengan retry OTOMATIS saat kena 429 (rate limit) — batch jalan terus tanpa gagal.
 * Backoff eksponensial 5s→10s→20s→40s→60s; hormati header Retry-After bila ada.
 * onWait(detik, percobaan) dipanggil sebelum tiap jeda agar UI bisa tampil status.
 * Setelah maxAttempts tetap 429 → lempar error ramah (bukan hang selamanya). */
async function fetchRetry429(url, fetchOpts, { maxAttempts = 12, onWait, paceKey } = {}) {
  let delayMs = 5000;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, fetchOpts);
    if (res.status !== 429) return res;
    if (paceKey) paceOn429(paceKey);
    if (attempt >= maxAttempts) {
      const t = await res.text().catch(() => "");
      throw new Error(`Limit tercapai (429) — sudah dicoba otomatis ${maxAttempts}x. Tunggu beberapa menit lalu coba lagi. ${t.slice(0, 120)}`);
    }
    const ra = parseInt(res.headers.get("Retry-After") || "", 10);
    const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120000) : delayMs;
    // Hitung mundur per detik agar UI terlihat hidup (tidak dikira macet)
    const totalSec = Math.max(1, Math.round(waitMs / 1000));
    for (let remain = totalSec; remain > 0; remain--) {
      try { onWait && onWait(remain, attempt); } catch { /* abaikan */ }
      await sleep(1000);
    }
    delayMs = Math.min(delayMs * 2, 60000);
  }
}

function applyGlossary(text, glossary) {
  let out = text;
  for (const g of glossary || []) {
    if (!g.source) continue;
    out = out.split(g.source).join(g.target || g.source);
  }
  return out;
}

async function translateDeepL({ apiKey, sourceLang, targetLang, texts, onWait, onChunk }) {
  // DeepL API tidak mengirim header CORS, jadi browser tidak bisa memanggilnya
  // langsung. Panggil via worker proxy di akun Cloudflare milik pengguna
  // (key hanya lewat di request, tidak disimpan).
  let res;
  try {
    res = await fetchRetry429("https://deepl.arvanity.my.id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: apiKey,
        texts,
        // "auto": jangan kirim source_lang — DeepL otomatis mendeteksi bahasa sumber
        ...(sourceLang && sourceLang !== "auto" ? { source_lang: sourceLang } : {}),
        target_lang: targetLang,
      }),
    }, { onWait, paceKey: "deepl" });
  } catch (e) {
    throw new Error("Proxy DeepL belum bisa dihubungi (gangguan Cloudflare). Coba lagi nanti, atau pakai Gemini/MyMemory sementara.");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepL error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.translations) throw new Error(`DeepL: ${data.message || "respons tak dikenal"}`);
  return data.translations.map((t) => t.text);
}

async function translateMyMemory({ sourceLang, targetLang, texts, apiKey, onProgress, onChunk }) {
  if (sourceLang === "auto") {
    throw new Error("MyMemory tidak mendukung deteksi bahasa otomatis — pilih bahasa sumber manual di Pengaturan.");
  }
  const out = [];
  const de = (apiKey || "").trim();
  for (let i = 0; i < texts.length; i++) {
    const q = encodeURIComponent(texts[i]);
    const url =
      `https://api.mymemory.translated.net/get?q=${q}` +
      `&langpair=${sourceLang.toLowerCase()}|${targetLang.toLowerCase()}` +
      (de ? `&de=${encodeURIComponent(de)}` : "");
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) throw new Error("MyMemory: limit harian tercapai (429). Isi email di Pengaturan untuk limit 10x lipat, atau coba besok.");
      throw new Error(`MyMemory error ${res.status}`);
    }
    const data = await res.json();
    if (data.responseStatus !== 200 && data.responseStatus !== "200") {
      throw new Error(`MyMemory: ${data.responseDetails || "limit tercapai?"}`);
    }
    out.push(data.responseData.translatedText);
    onProgress && onProgress(i + 1, texts.length);
    onChunk && onChunk(out.slice());
    onChunk && onChunk(out.slice());
    if (i < texts.length - 1) await sleep(600); // hormati rate limit
  }
  return out;
}

async function translateLibre({ endpoint, apiKey, sourceLang, targetLang, texts, onWait, onChunk }) {
  const out = [];
  const url = (endpoint || "https://libretranslate.com/translate").trim();
  for (let i = 0; i < texts.length; i++) {
    const body = {
      q: texts[i],
      source: sourceLang.toLowerCase(),
      target: targetLang.toLowerCase(),
      format: "text",
    };
    if (apiKey) body.api_key = apiKey;
    await paceBefore("libre");
    const res = await fetchRetry429(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, { onWait, paceKey: "libre" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`LibreTranslate error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    out.push(data.translatedText);
    paceAfterOk("libre");
  }
  return out;
}

const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash";
export const GEMINI_MODELS = [
  { id: "gemini-3.5-flash", name: "Flash — cepat & stabil (saran untuk volume besar)" },
  { id: "gemini-3.5-flash-lite", name: "Flash Lite — paling ringan & cepat" },
  { id: "gemini-3.8-flash", name: "Flash 3.8 — terbaru (kadang sibuk)" },
  { id: "gemini-3.1-pro-preview", name: "Pro — lebih pintar, limit gratis ketat" },
];
// Model lama yang bermasalah/dipensiunkan -> penggantinya (migrasi otomatis)
export const GEMINI_MODEL_ALIAS = {
  "gemini-2.0-flash": "gemini-3.5-flash",
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
};
// Urutan fallback otomatis bila model utama 503/404/429 (kuota gratis per model terpisah)
const GEMINI_FALLBACKS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
const GEMINI_LANG_NAMES = { ja: "Japanese", en: "English", id: "Indonesian", zh: "Chinese", ko: "Korean", th: "Thai", auto: "auto-detected" };

async function translateGemini({ apiKey, model, sourceLang, targetLang, texts, onProgress, onChunk, onModelFallback, onWait, mode = "translate" }) {
  if (!apiKey) throw new Error("Isi dulu Gemini API key di Pengaturan.");
  const useModel = GEMINI_MODEL_ALIAS[model] || model || GEMINI_DEFAULT_MODEL;
  const isPro = /pro/i.test(useModel);
  const isProofread = mode === "proofread";
  const srcName = GEMINI_LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = GEMINI_LANG_NAMES[targetLang] || targetLang;
  const out = [];
  const CHUNK = 15;
  // Model yang dicoba berurutan: pilihan user dulu, lalu fallback otomatis
  const candidates = [useModel, ...GEMINI_FALLBACKS.filter((m) => m !== useModel)];
  let activeModel = useModel, announced = false;

  // Satu request generateContent dengan fallback antar model (503/404/429 -> model berikut).
  // Bila SEMUA model kena 429 -> backoff-retry otomatis (jalan terus, tidak gagal).
  async function geminiRequest(body) {
    let delayMs = 5000;
    for (let attempt = 1; ; attempt++) {
      let lastErr = null;
      for (const m of candidates) {
        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent` +
          `?key=${encodeURIComponent(apiKey)}`;
        let res;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {
          lastErr = new Error(`Jaringan bermasalah: ${e.message || e}`);
          break; // bukan salah model — jangan buang waktu coba yang lain
        }
        if (res.ok) {
          if (m !== activeModel) {
            activeModel = m;
            if (!announced && onModelFallback) { announced = true; onModelFallback(useModel, m); }
          }
          return res.json();
        }
        const t = await res.text().catch(() => "");
        if (res.status === 400) throw new Error(`Gemini menolak permintaan (400) — periksa API key. ${t.slice(0, 120)}`);
        if ([403, 404, 429, 500, 502, 503].includes(res.status)) {
          lastErr = new Error(`Gemini ${res.status} (${m})`);
          continue; // coba model berikutnya
        }
        throw new Error(`Gemini error ${res.status}: ${t.slice(0, 200)}`);
      }
      // Sampai sini: semua model gagal. Hanya 429 yang di-retry otomatis.
      if (!lastErr || !/429/.test(lastErr.message)) throw lastErr || new Error("Gemini: semua model gagal dihubungi.");
      if (attempt >= 12) throw new Error("Gemini: limit tercapai (429) — sudah dicoba otomatis 12x. Tunggu beberapa menit lalu coba lagi.");
      // Hitung mundur per detik agar UI terlihat hidup (tidak dikira macet)
      const totalSec = Math.max(1, Math.round(delayMs / 1000));
      for (let remain = totalSec; remain > 0; remain--) {
        try { onWait && onWait(remain, attempt); } catch { /* abaikan */ }
        await sleep(1000);
      }
      delayMs = Math.min(delayMs * 2, 60000);
    }
  }

  for (let i = 0; i < texts.length; i += CHUNK) {
    const batch = texts.slice(i, i + CHUNK);
    const numbered = batch.map((t, j) => `${j + 1}. ${t}`).join("\n");
    const prompt = isProofread
      ? `Proofread and improve each numbered ${tgtName} visual-novel line. ` +
        `Fix grammar, typos, and unnatural phrasing, keeping the original meaning, character names, and tone. ` +
        `Keep placeholders like [ph id=0] and tags like [...] exactly unchanged — never translate, alter, remove, or move them. ` +
        `Return ONLY the corrected lines, one per line, keeping the same numbers and order. ` +
        `You MUST return exactly ${batch.length} numbered lines — one per input line, never skip, merge, or add lines. ` +
        `If a line is already good, return it unchanged. Do not add explanations.\n\n${numbered}`
      : `Translate each numbered ${srcName} visual-novel line to ${tgtName}. ` +
        `Keep tags like [...] and placeholders like {...} exactly unchanged. ` +
        `Return ONLY the translations, one per line, keeping the same numbers and order. ` +
        `Do not add explanations.\n\n${numbered}`;
    const data = await geminiRequest({
      systemInstruction: { parts: [{ text: isProofread
        ? `You are a professional ${tgtName} proofreader for visual novel translations.`
        : `You are a professional ${srcName} to ${tgtName} translator for visual novels.` }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
      // Game VN sering berisi dialog dewasa — matikan filter agar tidak diblokir diam-diam
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    });
    const reply = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    const needy = batch.filter((t) => t.trim()).length;
    let skipped = 0;
    for (let j = 0; j < batch.length; j++) {
      if (!batch[j].trim()) { out.push(batch[j]); continue; } // baris kosong -> biarkan
      const re = new RegExp(`^${j + 1}[.)\\-:]\\s*([\\s\\S]*)$`);
      const hit = lines.find((l) => re.test(l));
      const val = hit ? hit.replace(re, "$1").trim() : "";
      if (!val) {
        // v1.76: baris yang dilewati model dipertahankan aslinya
        // (seperti mode Poles) — jangan gagalkan satu file.
        out.push(batch[j]);
        skipped++;
        continue;
      }
      out.push(val);
    }
    // Kalau model tidak mengembalikan APA PUN yang bisa dipakai,
    // itu bukan baris terlewat — modelnya yang bermasalah.
    if (needy > 0 && skipped === needy) throw new Error("Gemini mengembalikan baris kosong — coba lagi.");
    onProgress && onProgress(Math.min(i + CHUNK, texts.length), texts.length);
    onChunk && onChunk(out.slice());
    onChunk && onChunk(out.slice());
    onChunk && onChunk(out.slice());
    onChunk && onChunk(out.slice());
    // jaga rate limit tier gratis: flash ~15 req/menit, pro ~5 req/menit
    if (i + CHUNK < texts.length) await sleep(isPro ? 15000 : 5000);
  }
  return out;
}

/* Terjemahkan via API OpenAI-compatible (OpenAI, DeepL... maksudnya DeepSeek, Groq, dll):
 * POST {baseUrl}/chat/completions langsung dari browser (semua mengirim CORS).
 * Format prompt & parsing bernomor sama seperti Gemini. */
async function translateOpenAI({ apiKey, oai, sourceLang, targetLang, texts, onProgress, onChunk, onWait }) {
  if (!apiKey) throw new Error("Isi dulu API key di Pengaturan.");
  const tgtName = GEMINI_LANG_NAMES[targetLang] || targetLang;
  const srcName = sourceLang === "auto" ? "auto-detected" : (GEMINI_LANG_NAMES[sourceLang] || sourceLang || "Japanese");
  const CHUNK = 15;
  const out = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const batch = texts.slice(i, i + CHUNK);
    const numbered = batch.map((t, j) => `${j + 1}. ${t}`).join("\n");
    let res;
    try {
      await paceBefore("oai"); // jeda adaptif tambahan bila sempat kena 429
      res = await fetchRetry429(`${oai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: oai.model,
          ...(oai.bodyExtra || {}),
          messages: [
            { role: "system", content: `You are a professional ${srcName} to ${tgtName} translator for visual novels.` },
            { role: "user", content:
              `Translate each numbered ${srcName} visual-novel line to ${tgtName}. ` +
              `Keep tags like [...] and placeholders like [ph id=0] exactly unchanged. ` +
              `Return ONLY the translations, one per line, keeping the same numbers and order. ` +
              `Do not add explanations.\n\n${numbered}` },
          ],
          temperature: 0.3,
        }),
      }, { onWait, paceKey: "oai" });
    } catch (e) {
      throw new Error(`Jaringan bermasalah: ${e.message || e}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("API key ditolak (401) — periksa key di Pengaturan.");
      if (res.status === 402) throw new Error("Saldo habis (402) — top-up dulu di situs penyedia.");
      if (res.status === 429) throw new Error("Limit tercapai (429) — tunggu sebentar lalu coba lagi.");
      if (/decommission|model_not_found|does not exist/i.test(t)) throw new Error("Model yang dipakai sudah dimatikan penyedia — vn-translator perlu diperbarui ke model baru.");
      throw new Error(`Error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => ({}));
    const reply = data.choices?.[0]?.message?.content || "";
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    const needy = batch.filter((t) => t.trim()).length;
    let skipped = 0;
    for (let j = 0; j < batch.length; j++) {
      if (!batch[j].trim()) { out.push(batch[j]); continue; } // baris kosong -> biarkan
      const re = new RegExp(`^${j + 1}[.)\\-:]\\s*([\\s\\S]*)$`);
      const hit = lines.find((l) => re.test(l));
      const val = hit ? hit.replace(re, "$1").trim() : "";
      if (!val) {
        // v1.76: baris yang dilewati model dipertahankan aslinya
        // (seperti mode Poles) — jangan gagalkan satu file.
        out.push(batch[j]);
        skipped++;
        continue;
      }
      out.push(val);
    }
    // Kalau model tidak mengembalikan APA PUN yang bisa dipakai,
    // itu bukan baris terlewat — modelnya yang bermasalah.
    if (needy > 0 && skipped === needy) throw new Error("Model mengembalikan baris kosong — coba lagi.");
    onProgress && onProgress(Math.min(i + CHUNK, texts.length), texts.length);
    paceAfterOk("oai");
    if (i + CHUNK < texts.length) await sleep(oai.gapMs || 2000);
  }
  return out;
}

/* Poles via API OpenAI-compatible: prompt & parsing sama seperti Gemini proofread.
 * Baris yang dilewati model dipertahankan aslinya (lebih aman dari gagal total). */
async function proofreadOpenAI({ apiKey, oai, targetLang, texts, onProgress, onChunk, onWait }) {
  if (!apiKey) throw new Error("Isi dulu API key di Pengaturan.");
  const tgtName = GEMINI_LANG_NAMES[targetLang] || targetLang;
  const CHUNK = 15;
  const out = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const batch = texts.slice(i, i + CHUNK);
    const numbered = batch.map((t, j) => `${j + 1}. ${t}`).join("\n");
    let res;
    try {
      await paceBefore("oai"); // jeda adaptif tambahan bila sempat kena 429
      res = await fetchRetry429(`${oai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: oai.model,
          ...(oai.bodyExtra || {}),
          messages: [
            { role: "system", content: `You are a professional ${tgtName} proofreader for visual novel translations.` },
            { role: "user", content:
              `Proofread and improve each numbered ${tgtName} visual-novel line. ` +
              `Fix grammar, typos, and unnatural phrasing, keeping the original meaning, character names, and tone. ` +
              `Keep placeholders like [ph id=0] and tags like [...] exactly unchanged — never translate, alter, remove, or move them. ` +
              `Return ONLY the corrected lines, one per line, keeping the same numbers and order. ` +
              `You MUST return exactly ${batch.length} numbered lines — one per input line, never skip, merge, or add lines. ` +
              `If a line is already good, return it unchanged. Do not add explanations.\n\n${numbered}` },
          ],
          temperature: 0.3,
        }),
      }, { onWait, paceKey: "oai" });
    } catch (e) {
      throw new Error(`Jaringan bermasalah: ${e.message || e}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("API key ditolak (401) — periksa key di Pengaturan.");
      if (res.status === 402) throw new Error("Saldo habis (402) — top-up dulu di situs penyedia.");
      if (res.status === 429) throw new Error("Limit tercapai (429) — tunggu sebentar lalu coba lagi.");
      if (/decommission|model_not_found|does not exist/i.test(t)) throw new Error("Model yang dipakai sudah dimatikan penyedia — vn-translator perlu diperbarui ke model baru.");
      throw new Error(`Error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => ({}));
    const reply = data.choices?.[0]?.message?.content || "";
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let j = 0; j < batch.length; j++) {
      if (!batch[j].trim()) { out.push(batch[j]); continue; }
      const re = new RegExp(`^${j + 1}[.)\\-:]\\s*([\\s\\S]*)$`);
      const hit = lines.find((l) => re.test(l));
      const val = hit ? hit.replace(re, "$1").trim() : "";
      out.push(val || batch[j]); // dilewati model -> pakai aslinya
    }
    onProgress && onProgress(Math.min(i + CHUNK, texts.length), texts.length);
    paceAfterOk("oai");
    if (i + CHUNK < texts.length) await sleep(oai.gapMs || 2000);
  }
  return out;
}

/* Claude via worker proxy (CORS Anthropic tidak stabil dari browser).
 * Browser POST {service:"claude", ...} ke worker; worker meneruskan ke
 * api.anthropic.com/v1/messages dan mengembalikan status+body apa adanya. */
const CLAUDE_WORKER_URL = "https://deepl.arvanity.my.id";

async function claudeRequest({ apiKey, model, system, messages, maxTokens, onWait }) {
  let res;
  try {
    res = await fetchRetry429(CLAUDE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "claude",
        key: apiKey,
        model,
        system,
        messages,
        max_tokens: maxTokens || 4096,
        temperature: 0.3,
      }),
    }, { onWait, paceKey: "claude" });
  } catch (e) {
    throw new Error("Proxy belum bisa dihubungi (gangguan Cloudflare). Coba lagi nanti.");
  }
  const t = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = t.slice(0, 200);
    try { const j = JSON.parse(t); if (j.error && j.error.message) msg = String(j.error.message).slice(0, 200); } catch { /* pakai mentah */ }
    if (res.status === 401) throw new Error("API key Claude ditolak (401) — periksa key di Pengaturan.");
    if (res.status === 429) throw new Error("Limit Claude tercapai (429) — tunggu sebentar lalu coba lagi.");
    throw new Error(`Claude error ${res.status}: ${msg}`);
  }
  const data = JSON.parse(t);
  return (data.content || []).filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
}

async function translateClaude({ apiKey, model, sourceLang, targetLang, texts, onProgress, onChunk, onWait, mode }) {
  if (!apiKey) throw new Error("Isi dulu API key di Pengaturan.");
  const isProofread = mode === "proofread";
  const tgtName = GEMINI_LANG_NAMES[targetLang] || targetLang;
  const srcName = sourceLang === "auto" ? "auto-detected" : (GEMINI_LANG_NAMES[sourceLang] || sourceLang || "Japanese");
  const CHUNK = 15;
  const out = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const batch = texts.slice(i, i + CHUNK);
    const numbered = batch.map((t, j) => `${j + 1}. ${t}`).join("\n");
    const prompt = isProofread
      ? `Proofread and improve each numbered ${tgtName} visual-novel line. ` +
        `Fix grammar, typos, and unnatural phrasing, keeping the original meaning, character names, and tone. ` +
        `Keep placeholders like [ph id=0] and tags like [...] exactly unchanged — never translate, alter, remove, or move them. ` +
        `Return ONLY the corrected lines, one per line, keeping the same numbers and order. ` +
        `You MUST return exactly ${batch.length} numbered lines — one per input line, never skip, merge, or add lines. ` +
        `If a line is already good, return it unchanged. Do not add explanations.\n\n${numbered}`
      : `Translate each numbered ${srcName} visual-novel line to ${tgtName}. ` +
        `Keep tags like [...] and placeholders like [ph id=0] exactly unchanged. ` +
        `Return ONLY the translations, one per line, keeping the same numbers and order. ` +
        `Do not add explanations.\n\n${numbered}`;
    await paceBefore("claude"); // jeda adaptif tambahan bila sempat kena 429
    const reply = await claudeRequest({
      apiKey,
      model: model || "claude-haiku-4-5",
      system: isProofread
        ? `You are a professional ${tgtName} proofreader for visual novel translations.`
        : `You are a professional ${srcName} to ${tgtName} translator for visual novels.`,
      messages: [{ role: "user", content: prompt }],
      onWait,
    });
    const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
    const needy = batch.filter((t) => t.trim()).length;
    let skipped = 0;
    for (let j = 0; j < batch.length; j++) {
      if (!batch[j].trim()) { out.push(batch[j]); continue; } // baris kosong -> biarkan
      const re = new RegExp(`^${j + 1}[.)\\-:]\\s*([\\s\\S]*)$`);
      const hit = lines.find((l) => re.test(l));
      const val = hit ? hit.replace(re, "$1").trim() : "";
      if (!val) {
        // v1.76: baris yang dilewati model dipertahankan aslinya
        // (seperti mode Poles) — jangan gagalkan satu file.
        out.push(batch[j]);
        skipped++;
        continue;
      }
      out.push(val);
    }
    // Kalau model tidak mengembalikan APA PUN yang bisa dipakai,
    // itu bukan baris terlewat — modelnya yang bermasalah.
    if (needy > 0 && skipped === needy) throw new Error("Claude mengembalikan baris kosong — coba lagi.");
    onProgress && onProgress(Math.min(i + CHUNK, texts.length), texts.length);
    paceAfterOk("claude");
    if (i + CHUNK < texts.length) await sleep(2000);
  }
  return out;
}

/* Terjemahkan batch teks. Melempar Error dengan pesan ramah jika gagal. */
export async function translateBatch({
  providerId,
  apiKey,
  endpoint,
  sourceLang,
  targetLang,
  texts,
  glossary,
  onProgress,
  onChunk,
  onWait,
  model,
  onModelFallback,
}) {
  const prepared = texts.map((t) => applyGlossary(t, glossary));
  const args = { apiKey, endpoint, sourceLang, targetLang, onProgress, onChunk, onWait, model, onModelFallback };
  const prov = getProvider(providerId);
  // Penyedia OpenAI-compatible (OpenAI, DeepSeek, Groq): satu implementasi
  if (prov && prov.oai) {
    return translateOpenAI({ apiKey, oai: prov.oai, sourceLang, targetLang, texts: prepared, onProgress, onChunk, onWait });
  }
  // Claude: via worker proxy (format Messages API milik Anthropic)
  if (prov && prov.claude) {
    return translateClaude({ apiKey, model: prov.claude.model, sourceLang, targetLang, texts: prepared, onProgress, onChunk, onWait });
  }
  if (providerId === "deepl") {
    if (!apiKey) throw new Error("Isi dulu DeepL API key di Pengaturan.");
    const out = [];
    const CHUNK = 40;
    for (let i = 0; i < prepared.length; i += CHUNK) {
      const part = await translateDeepL({ ...args, texts: prepared.slice(i, i + CHUNK) });
      out.push(...part);
      onProgress && onProgress(Math.min(i + CHUNK, prepared.length), prepared.length);
    onChunk && onChunk(out.slice());
    }
    return out;
  }
  if (providerId === "gemini") {
    return translateGemini({ ...args, texts: prepared });
  }
  if (providerId === "mymemory") {
    return translateMyMemory({ ...args, texts: prepared });
  }
  if (providerId === "libretranslate") {
    return translateLibre({ ...args, texts: prepared });
  }
  throw new Error("Penyedia tidak dikenal.");
}

/* Poles kalimat terjemahan dengan Gemini: perbaiki tata bahasa, typo, dan
 * kefasihan tanpa mengubah makna. texts = kalimat TERJEMAHAN (bukan sumber).
 * Selalu pakai Gemini (satu-satunya penyedia AI). Melempar Error bila gagal. */
export async function proofreadBatch({
  providerId,
  oai,
  apiKey,
  model,
  targetLang,
  texts,
  onProgress,
  onChunk,
  onWait,
  onModelFallback,
}) {
  // Penyedia OpenAI-compatible (Groq/DeepSeek/OpenAI) bisa memoles langsung;
  // DeepL/MyMemory/LibreTranslate tidak punya fitur proofread -> fallback ke pemanggil
  const prov = getProvider(providerId);
  if (prov && prov.oai) {
    return proofreadOpenAI({ apiKey, oai: prov.oai, targetLang, texts, onProgress, onChunk, onWait });
  }
  if (prov && prov.claude) {
    return translateClaude({ apiKey, model: prov.claude.model, targetLang, texts, onProgress, onChunk, onWait, mode: "proofread" });
  }
  return translateGemini({
    apiKey,
    model,
    sourceLang: targetLang,
    targetLang,
    texts,
    onProgress,
    onChunk,
    onWait,
    onModelFallback,
    mode: "proofread",
  });
}

export const LANGS = [
  { code: "ja", label: "Jepang" },
  { code: "en", label: "Inggris" },
  { code: "id", label: "Indonesia" },
  { code: "zh", label: "Tionghoa" },
  { code: "ko", label: "Korea" },
  { code: "th", label: "Thailand" },
];

/* Pilihan bahasa SUMBER: LANGS + deteksi otomatis di urutan pertama.
 * "auto" hanya valid sebagai bahasa sumber, bukan target. */
export const SOURCE_LANGS = [
  { code: "auto", label: "🌐 Otomatis (deteksi bahasa)" },
  ...LANGS,
];
