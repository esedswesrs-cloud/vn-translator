# VNTranslate — Penerjemah Script Visual Novel

Aplikasi web **statis** (tanpa server, tanpa database) untuk menerjemahkan file
script visual novel. Semua proses berjalan di browser pengunjung — file tidak
pernah diunggah ke server mana pun.

## Fitur

- **Upload & deteksi otomatis** — engine terdeteksi dari ekstensi + isi file
  (bisa diubah manual bila ambigu, mis. `.txt` milik Kirikiri vs RealLive).
- **Deteksi encoding otomatis** — UTF-8, UTF-16, Shift-JIS (umum untuk script Jepang).
- **Editor terjemahan** — tabel berdampingan (teks asli ↔ terjemahan), progres,
  pencarian, filter (semua / belum / sudah diterjemahkan).
- **Terjemahan mesin (gratis)** — tiga penyedia, bisa diganti di Pengaturan:
  - **DeepL (Free)** — butuh API key gratis dari <https://www.deepl.com/pro-api>
    (500 ribu karakter/bulan, kualitas terbaik untuk Jepang→Indonesia).
  - **MyMemory** — tanpa key, limit harian kecil, cocok untuk coba-coba.
  - **LibreTranslate** — isi endpoint sendiri/publik.
- **Glosarium** — istilah (mis. nama karakter) diganti otomatis sebelum
  dikirim ke mesin penerjemah agar konsisten.
- **Ekspor** — unduh file script yang sudah diterjemahkan dalam format aslinya,
  plus ekspor CSV dan simpan/muat proyek (JSON).
- **Daftar 22 engine** — 8 didukung penuh di v1 (lihat bawah), sisanya
  "segera hadir".

## Engine yang didukung (v1)

| Engine | Ekstensi | Catatan |
|---|---|---|
| Ren'Py | `.rpy` | Dialog, narasi, pilihan menu; nama pembicara terdeteksi dari `define Character` |
| Kirikiri (KAG) | `.ks`, `.scn`, `.txt` | Baris pesan; tag inline `[r]`, `[p]`, `[ruby]` dipertahankan |
| Kirikiri (arsip .xp3) | `.xp3` | Penjelajah arsip: ekstrak file & terjemahkan `.ks` langsung di web |
| RealLive | `.txt` | Heuristik baris (perintah `#` dilewati); umumnya Shift-JIS |
| TyranoBuilder (TyranoScript) | `.ks` | Baris `#Nama` jadi segmen nama pembicara; blok `[iscript]` dilewati |
| RPG Maker MV/MZ | `.json` | File `www/data/*.json`: dialog event, pilihan, database |
| YU-RIS | `.ypf` / `.ybn` | Penjelajah arsip + terjemahan script YSTB V300 langsung di web |

Engine lain (Artemis, Majiro, YU-RIS, CatSystem2, dll.) menyusul di pembaruan
berikutnya.

## Cara deploy ke domain

Karena ini web statis, caranya semudah upload file biasa:

1. Ekstrak `vn-translator.zip`.
2. Upload **seluruh isi folder** ke `public_html` (cPanel) atau root hosting kamu.
3. Buka domain kamu — selesai. Tidak perlu Node, PHP, atau database.

Alternatif gratis: drag-and-drop folder ke Netlify Drop / Vercel / GitHub Pages.

## Cara pakai

1. Buka tab **Beranda** → seret file script ke kotak upload.
2. Periksa engine yang terdeteksi → klik **Mulai Menerjemahkan**.
3. Di **Editor**: terjemahkan manual, atau klik **⚡ Terjemahkan Otomatis**.
   Atur penyedia & API key di tab **Pengaturan** dulu bila memakai DeepL.
4. Tambahkan istilah penting di **📖 Glosarium**.
5. Klik **⬇ Ekspor File** untuk mengunduh hasilnya.

## Struktur proyek

```
index.html          halaman utama
css/style.css       tampilan
js/app.js           logika UI
js/engines.js       registry 22 engine + deteksi otomatis
js/parsers/         parser per engine (renpy, kirikiri, reallive)
js/mt.js            penyedia mesin penerjemah gratis
js/store.js         penyimpanan proyek (localStorage)
tests/              uji round-trip parser (node tests/run.mjs)
```

## Batasan v1

- Ekspor selalu UTF-8 kecuali pustaka Shift-JIS (CDN) berhasil dimuat; untuk
  file Shift-JIS, hasil ekspor disarankan dicek ulang di game.
- Terjemahan mesin butuh koneksi internet & tunduk pada limit tiap penyedia.
- Format biner (`.bin`, `.mjo`, `.ybn`, dll.) belum didukung.

Dibuat dengan ❤️ untuk komunitas penerjemah visual novel Indonesia.
