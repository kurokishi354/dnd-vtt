# DnD VTT — Character Sheet + DM Board (lokal, via localhost)

Aplikasi kecil untuk main D&D (atau sistem sejenis) bareng teman lewat browser:
- **Character sheet interaktif** untuk player (auto-hitung modifier, auto-save).
- **DM Board / VTT ringan**: peta + grid + token, daftar pemain (lihat HP & sheet real-time), sheet NPC, initiative tracker, dan log chat/dice.
- Jalan sebagai **server lokal** (Node.js), semua orang connect ke satu komputer host lewat jaringan yang sama. Tidak butuh database atau akun — cukup **kode sesi 5 karakter**.

## 1. Yang perlu di-install
- **Node.js** (versi 18 ke atas) — download di https://nodejs.org (pilih versi LTS).

## 2. Cara menjalankan

Buka terminal / command prompt di folder ini (`dnd-vtt`), lalu:

```bash
npm install
npm start
```

Kalau berhasil, akan muncul:

```
DnD VTT server jalan di http://localhost:3000
```

## 3. Cara main

### Jika kamu DM (host)
1. Buka `http://localhost:3000` di browser.
2. Pilih **"Aku Dungeon Master"** → isi nama → **Buat Sesi Baru**.
3. Kamu akan diarahkan ke **DM Board**, dan dapat **kode sesi 5 karakter** (mis. `K7X2P`) yang muncul di pojok kanan atas.
4. Bagikan kode itu ke pemain lain.
5. Kalau browser DM tertutup / server restart, tinggal buka lagi `http://localhost:3000` → pilih DM → masukkan kode sesi yang sama di kolom **"Lanjutkan Sesi"**. Data tidak hilang (tersimpan di `data/sessions.json`).

### Jika kamu Player
1. Buka `http://localhost:3000` (kalau main di komputer yang sama), **atau** alamat IP DM (lihat bagian "Main lewat jaringan" di bawah).
2. Pilih **"Aku Player"** → isi nama & kode sesi dari DM → **Gabung Sesi**.
3. Kamu masuk ke halaman **Character Sheet** — isi semua data karaktermu. Semua perubahan **otomatis tersimpan** dan langsung terlihat oleh DM (nama, HP, level, dll).
4. Kalau kamu tutup tab / refresh, tinggal join lagi dengan kode & nama yang sama — sheet-mu tetap ada (disimpan otomatis di browser lewat `localStorage` + di server).

### Main lewat jaringan (DM & player beda laptop/HP, tapi satu WiFi)
`localhost` hanya bisa diakses dari komputer yang sama dengan servernya. Supaya teman lain (di WiFi yang sama) bisa ikut:

1. Di komputer DM, cari **alamat IP lokal**-nya:
   - Windows: buka CMD → ketik `ipconfig` → lihat `IPv4 Address` (contoh: `192.168.1.5`)
   - Mac/Linux: buka terminal → ketik `ifconfig` atau `ip a` → cari alamat yang mirip `192.168.x.x`
2. Pastikan server sudah jalan (`npm start`).
3. Pemain lain buka browser dan ketik: `http://192.168.1.5:3000` (ganti dengan IP DM tadi).
4. Kalau tidak bisa connect, cek firewall komputer DM — izinkan koneksi masuk ke port `3000`.

Semua device harus terhubung ke **WiFi/jaringan yang sama** dengan komputer DM.

## 4. Fitur DM Board
- **Peta & Grid**: upload gambar peta (JPG/PNG), atur ukuran grid, toggle tampil/sembunyi grid.
- **Token**: tambah token warna-warni dengan label singkat, drag untuk pindah posisi, klik-kanan untuk hapus. Token bisa di-assign ke seorang player lewat dropdown "Assign ke Player" — kalau di-assign, player itu bisa geser tokennya sendiri dari halaman sheet-nya.
- **Daftar Pemain**: lihat siapa yang online, HP real-time, klik nama untuk buka ringkasan sheet lengkap.
- **NPC**: buat/edit/hapus sheet NPC dengan stat, AC, bar HP/MP/SP, equipment (senjata/gear, bisa tambah berapa pun), inventory (bisa tambah berapa pun), skill/attack, dan catatan rahasia (hanya terlihat DM).
- **Beri Item ke Player**: dari panel detail seorang player, DM bisa ketik nama item + qty dan kirim — item langsung muncul di inventory player itu secara real-time (ditandai label "dari DM").
- **Lihat Inventory & Gold Player**: panel detail seorang player sekarang menampilkan isi inventory-nya dan **gold saat ini** secara langsung. DM bisa menambah/mengurangi gold (isi minus untuk mengurangi) atau langsung **"Set Ulang"** ke angka pasti — berguna kalau player mengisi gold asal-asalan.
- **Battle & Giliran**: tambah peserta battle langsung dari daftar Player atau NPC yang sudah ada (atau custom untuk ally tambahan), tandai tipe PC/Ally/Enemy, isi roll initiative + HP/MP/SP. Urutan giliran otomatis mengikuti roll terbesar; tombol Prev/Next menggerakkan giliran & round. Update ini langsung tersiar ke semua player. **HP tiap peserta terlihat oleh player** (di tab Peta & Battle mereka), tapi **MP & SP di daftar battle ini hanya terlihat & bisa diedit oleh DM** — player tidak melihat angka MP/SP musuh maupun ally di layar mereka.
- **Log & Dice**: klik tombol dadu cepat (d4–d100) atau ketik pesan / `/roll 1d20+3` untuk melempar dadu, hasilnya tercatat di log — log ini **sama persis** dengan yang dilihat semua player. Ada tombol **"Bersihkan Log"** untuk mereset seluruhnya kalau sudah penuh/tidak relevan lagi.

## 4b. Character Sheet — Inventory
Slot item **tidak dibatasi** — tekan "+ Tambah Slot Item" untuk menambah sebanyak yang dibutuhkan, dan tombol "×" di tiap baris untuk menghapus slot yang tidak dipakai. Item yang dikirim langsung oleh DM akan muncul otomatis dengan label hijau "dari DM" dan notifikasi singkat di pojok layar.

## 4c. Character Sheet — Tab "Peta & Battle"
Selain tab Sheet, player sekarang punya tab **🗺 Peta & Battle** yang menampilkan:
- Peta pertempuran yang sama dengan yang di-upload DM (gambar + grid), termasuk semua token — kalau DM meng-assign token ke karaktermu, token itu bisa kamu geser sendiri.
- Daftar battle & giliran yang sedang berjalan (siapa PC/Ally/Enemy, HP masing-masing, dan siapa yang sedang giliran) — kalau lagi giliranmu, ada penanda "⚡ Ini giliranmu!". Semua ini update otomatis begitu DM mengubahnya, tanpa perlu refresh halaman.
- **Status battle**: AC, HP, MP, SP (HP/MP/SP bisa diedit langsung dari sini), serta daftar skill Active/Passive/Ultimate.
- **Equipment & Buff Aktif**: Equipment (2 slot) dan Extra Slot Weapon (2 slot) ditampilkan sebagai referensi cepat (ATK/DMG-nya) biar gak lupa pas mau serang musuh — dan **Buff/Debuff bisa langsung ditambah, diedit, atau dihapus di tab ini juga** (otomatis sinkron dua arah dengan daftar Buff/Debuff di tab Sheet).
- **🎲 Roll Dadu**: tombol cepat d4–d100 atau formula custom (mis. `2d6+3`), hasilnya masuk ke log yang **sama dengan log milik DM** — jadi DM dan semua player lain langsung lihat siapa roll apa. Ada tombol "Bersihkan Log" di sini juga (siapa pun bisa mereset log bersama ini).
- **Pet/Summon**: kalau kolom pet di tab Sheet diisi, ringkasannya (HP/MP/Level/Skill) otomatis muncul di sini juga.

## 4d. DM: Beri Gold ke Player
Di panel detail seorang player (klik nama player di daftar Pemain), sekarang ada kotak **🪙 Beri Gold ke Player Ini**. DM tinggal isi jumlah dan klik Kirim — gold player itu langsung bertambah (isi angka minus untuk mengurangi, mis. saat belanja/kena pencurian). Perubahan langsung muncul di sheet player secara real-time beserta notifikasi singkat.

## 4e. Sistem Kelas (Class) & Rank Up
- **DM membuat katalog Kelas** di panel **🎓 Kelas & Skill** (sidebar kiri, sebelah panel NPC): nama kelas, tier/rank (opsional), deskripsi, dan daftar skill (Active/Passive/Ultimate) yang beda-beda untuk tiap kelas.
- **DM membuka ("rank up") kelas tertentu untuk seorang player** lewat panel detail player → kotak **🔓 Buka Kelas (Rank Up)**: centang kelas mana saja yang boleh dipilih player itu, lalu simpan.
- **Player memilih sendiri kelasnya** dari kelas-kelas yang sudah dibuka DM, lewat panel **🎓 Kelas & Rank Up** di sheet-nya. Player juga bisa **ganti kelas** kapan saja selama masih dalam daftar kelas yang terbuka untuknya.
- Begitu kelas dipilih/diganti, **Active/Passive/Ultimate Skill di sheet player otomatis terisi** sesuai skill kelas tersebut (menggantikan skill sebelumnya) — jadi tiap kelas benar-benar punya skill yang berbeda.

## 4f. DM: Hapus Player
Di panel detail player ada tombol **🗑 Hapus Player Ini** (juga tersedia sebagai ikon "×" kecil langsung di daftar Pemain). Sebelum benar-benar terhapus, selalu muncul konfirmasi **"Anda yakin?!"** dulu. Kalau dikonfirmasi: player beserta sheet-nya dihapus permanen dari sesi, token & entri battle miliknya ikut dibersihkan, dan kalau playernya sedang online, dia otomatis dikeluarkan dan diarahkan balik ke halaman awal.

## 4g. DM: Beri & Kelola Pet Player
Pet sekarang **harus diberikan dulu oleh DM** lewat kotak **🐾 Beri / Atur Pet Player Ini** di panel detail player (nama, tipe, level, HP, MP, skill, catatan). Setelah disimpan, pet langsung muncul di sheet player. Nama/Tipe/Level/Skill/Catatan pet hanya bisa diubah DM (read-only di sisi player, sama seperti kelas) — tapi **HP & MP pet tetap bisa diupdate sendiri oleh player**, termasuk lewat quick-edit di tab **Peta & Battle**, karena itu biasanya berubah-ubah pas lagi bertarung.

## 4h. Biar Gak Delay/Lag Pas Main Bareng
Gambar map sekarang **otomatis dikompres & di-resize di browser DM** sebelum dikirim ke server/pemain (maks. sisi terpanjang 1600px, kualitas ~82%) — foto map dari HP yang tadinya 5-10MB biasanya jadi di bawah 500KB tanpa kelihatan bedanya di layar. Ini penyebab lag paling umum karena gambar besar dikirim ke semua pemain lewat koneksi yang sama.
Beberapa hal lain di luar kode yang juga berpengaruh ke delay:
- **Hosting**: jalankan server ini di layanan cloud (Railway/Render/VPS, dll), bukan cuma di laptop DM lewat WiFi rumah/hotspot — supaya semua pemain konek ke server yang sama dengan koneksi stabil, bukan lewat 1 koneksi DM yang jadi bottleneck.
- **Koneksi internet**: pastikan DM & pemain pakai koneksi yang stabil (hindari hotspot HP yang sinyalnya naik-turun).
- **Ukuran gambar token/aset lain**: kalau nambah gambar lain di masa depan, usahakan sudah dikompres juga sebelum upload.
- Kalau masih lag, coba cek jumlah tab/aplikasi berat lain yang dibuka bersamaan di HP/laptop masing-masing pemain — makin sedikit beban di device, makin responsif juga socket-nya.

## 4i. Musik Sesi (BGM)
Ada panel **🎵 Musik** di sidebar kiri DM Board:
- **Tambah lagu**: upload file audio (MP3/OGG/WAV, dll) dari komputer, atau tempel link audio langsung (URL yang berakhiran file audio, atau server streaming audio langsung). Lagu yang sudah ditambah muncul sebagai daftar, tinggal klik **"Putar"** untuk memainkannya.
- **Kontrol**: Pause/Resume, Stop, checkbox **Ulangi** (loop), dan slider volume — semua ini adalah kontrol "master" yang berlaku buat semua orang di sesi.
- **Otomatis tersiar ke semua player** secara real-time & tersinkron (kalau player baru join/refresh di tengah lagu, posisi lagu ikut menyesuaikan).
- **Di sisi player**: muncul bar musik kecil di bagian bawah layar (nama lagu yang sedang main + tombol mute/volume). Tombol **"🔊 Aktifkan Musik"** wajib diklik sekali oleh tiap player — ini karena browser (Chrome, Safari, dll) memblokir audio otomatis sebelum ada klik dari user, bukan bug. Volume/mute di bar player ini **hanya berlaku lokal** di device masing-masing, tidak memengaruhi player lain.
- **Catatan ukuran file**: berbeda dari gambar map, file audio belum dikompres otomatis oleh aplikasi ini. Kalau upload file besar (misal >10-15MB) bisa terasa lag saat pertama kali dikirim ke semua pemain — kalau memungkinkan, pakai file MP3 yang sudah dikompres/durasi pendek, atau pakai opsi "tempel URL" untuk lagu yang sudah di-hosting di tempat lain.

## 4j. Export / Import Character Sheet (Player)
Di topbar halaman sheet ada tombol **⬇ Export** dan **⬆ Import**:
- **Export** mengunduh seluruh data sheet (identitas, ability, HP/MP/SP, equipment, inventory, skill, buff, dll) sebagai file `.json`.
- **Import** membaca file `.json` itu kembali, mengisi ulang seluruh sheet, lalu **otomatis tersimpan ke server** — sehingga data lama itu langsung muncul/update di **daftar Pemain milik DM** juga, sama seperti autosave biasa.

## 4k. Export / Import NPC (DM)
Di panel **👹 NPC**, tombol **⬇ Export NPC** mengunduh semua NPC (beserta stats, HP/MP/SP, equipment, inventory, catatan) sebagai satu file `.json`. Tombol **⬆ Import NPC** membaca file itu (atau file export dari sesi lain) dan menambahkan semua NPC di dalamnya sebagai NPC baru ke sesi yang sedang berjalan.

## 4l. Shop Item + Import/Export Excel (DM)
Panel **🛒 Shop Item** di sidebar kiri DM Board:
- Kelola katalog item toko manual (nama, harga, tipe, stok, deskripsi) lewat form kecil — klik item di daftar untuk edit, tombol "×" untuk hapus satu-satu, atau "Kosongkan Semua" untuk reset total.
- **Import langsung dari file Excel/CSV** (`.xlsx`/`.xls`/`.csv`) — cukup pilih file dengan kolom `nama, harga, tipe, stok, deskripsi` (nama kolom besar/kecil tidak masalah), semua barisnya otomatis masuk sebagai item toko.
- **Export ke Excel** untuk mengunduh seluruh katalog toko saat ini sebagai file `.xlsx`, gampang untuk diedit di Excel/Google Sheets lalu diimpor ulang.

## 4m. Skill dengan Cost MP/SP (auto-kurang saat dipakai)
Tiap skill (Active/Passive/Ultimate) di sheet sekarang punya kolom tambahan: **Cost MP**, **Cost SP**, dan **Formula Dadu** (opsional, mis. `1d8+3`). Skill yang dibuat DM di katalog Kelas juga bisa diisi cost yang sama, dan otomatis ikut ter-copy ke player saat memilih/ganti kelas.

Di tab **Peta & Battle**, tiap skill yang sudah diisi punya tombol **⚡ Pakai**:
- Begitu diklik, **MP dan/atau SP karaktermu otomatis berkurang** sesuai cost skill itu (kalau MP/SP tidak cukup, tombol akan menolak & memberi peringatan).
- Penggunaan skill tercatat di log chat bersama.
- Kalau skill itu punya Formula Dadu, formula-nya otomatis diisi ke panel **🎯 Aksi Roll** di bawahnya — tinggal pilih target & klik Roll.

## 4n. Aksi Roll: Damage / Heal / Buff / Debuff / Ultimate / Regen / AC
Baik player (tab Peta & Battle) maupun DM (sidebar kanan DM Board) punya panel **🎯 Aksi Roll**:
1. Pilih **target** dari daftar peserta battle yang sedang berjalan.
2. Pilih **jenis aksi**: Damage, Heal, Buff, Debuff, Ultimate, Regen Mana, Regen SP, Buff AC, atau Debuff AC.
3. Isi **formula dadu** (mis. `1d8+3`, `2d6`, atau angka flat) lalu klik **🎲 Roll & Terapkan**.

Hasilnya langsung diterapkan ke data battle target secara real-time untuk semua orang:
- **Damage/Ultimate** → HP target langsung berkurang sebesar hasil roll.
- **Heal** → HP target bertambah (juga cocok dipakai untuk pemakaian item yang menambah HP — tinggal target diri sendiri).
- **Regen Mana/Regen SP** → MP/SP target bertambah.
- **Buff AC/Debuff AC** → AC target ikut naik/turun.
- **Buff/Debuff** → tercatat di log sebagai penanda efek (tidak mengubah angka HP/MP/SP/AC, dipakai bareng catatan Buff/Debuff manual yang sudah ada di sheet).

Semua hasil roll otomatis masuk ke log chat bersama, kelihatan oleh semua orang di sesi.

**Penting — DM hanya memantau PC:** kolom HP/MP/SP/AC milik PC di daftar battle DM otomatis jadi **read-only**. Stat karakter player hanya bisa diubah oleh player itu sendiri lewat sheet-nya — DM cuma bisa lihat perkembangannya secara real-time.

**DM tidak "roll sendiri" — harus lewat Aktor:** di panel Aksi Roll DM, sebelum bisa Roll & Terapkan, DM wajib pilih dulu **Aktor** — yaitu peserta battle bertipe NPC/Ally/Enemy yang lagi melakukan aksi itu (bukan DM yang asal roll tanpa sumber). Kalau Aktor itu terhubung ke NPC yang skill-nya sudah diisi (lihat poin di bawah), tinggal pilih skill dari dropdown **Skill** — formula dadu, jenis aksi, dan cost MP/SP-nya otomatis terisi & otomatis dikurangi dari Aktor pas di-roll (persis seperti player pakai skill dari sheet-nya). Kalau tidak pilih skill, formula bisa diisi manual seperti biasa.

## 4n2. NPC: Skill Terstruktur (Active/Passive/Ultimate)
Panel **👹 NPC** sekarang punya bagian skill terstruktur yang formatnya sama seperti skill Kelas: tiap skill punya nama, jenis aksi (Damage/Heal/Buff/dst), Cost MP, Cost SP, dan Formula Dadu — bisa tambah sebanyak yang dibutuhkan per kategori (Active/Passive/Ultimate). Skill ini yang muncul di dropdown **Skill** pada panel Aksi Roll DM begitu NPC itu dijadikan Aktor di battle. Kolom "Catatan Skill / Attack" lama tetap ada untuk catatan bebas di luar skill terstruktur.

## 4n3. NPC sebagai Daftar Enemy Siap Pakai
NPC yang sudah dibuat berfungsi sebagai daftar enemy/ally yang bisa dipakai berkali-kali. Tiap kartu NPC di panel **👹 NPC** sekarang punya tombol **⚔** — klik untuk langsung menambahkan NPC itu ke Battle & Giliran (sebagai Enemy) tanpa perlu mengisi ulang form "Tambah ke Battle" satu-satu. Roll initiative-nya dikosongkan dulu dan tinggal diisi langsung di baris battle-nya. Kombinasikan dengan Export/Import NPC (poin 4k) untuk punya "bestiary" musuh yang bisa dipakai ulang lintas sesi.

## 4o. Story-telling: Scene Banner, Dialog NPC, Quest Tracker, Handout, Recap
Tab baru **📖 Cerita** (DM Board) berisi 5 fitur yang saling melengkapi untuk membangun narasi sesi:

- **🎬 Scene Banner**: DM isi judul + deskripsi + (opsional) gambar suasana, lalu klik "📢 Tampilkan ke Semua" — muncul sebagai banner besar di atas layar semua player (mirip transisi adegan di game), sampai DM klik "✖ Sembunyikan Banner" atau player menutupnya sendiri secara lokal. Setiap kali ditampilkan otomatis tercatat di log sebagai entri bertipe "narrative".
- **💬 Dialog NPC**: DM pilih NPC dari daftar (opsional, auto-isi nama) atau ketik nama bebas, upload potret (opsional), ketik dialog, lalu klik "🗣 Katakan" — muncul sebagai kotak dialog ala visual novel di bagian bawah layar semua player. Tiap dialog juga tercatat di log.
- **📜 Quest / Objective Tracker**: DM bikin/edit quest (judul, deskripsi, status Aktif/Selesai/Gagal). Player lihat versi read-only di tab **📖 Cerita** miliknya. Perubahan status otomatis diumumkan di log ("✅ Quest selesai: ...", dst).
- **🎁 Handout (kirim dokumen)**: DM kirim gambar/surat/catatan ke satu player tertentu atau semua sekaligus — muncul sebagai popup di layar penerima, plus notifikasi kecil di pojok layar.
- **⭐ Recap / Riwayat Cerita**: panel yang otomatis merangkum semua momen cerita (scene, dialog, quest, handout) secara kronologis — cocok dipakai DM untuk baca ulang "sebelumnya di sesi ini..." sebelum mulai sesi berikutnya. DM juga bisa menandai entri log biasa di tab Utama dengan tombol ⭐ supaya ikut masuk ke Recap ini.

Player bisa lihat Quest & Recap lewat tab **📖 Cerita** di sheet-nya (read-only) — Scene Banner dan Dialog NPC muncul otomatis sebagai overlay dari tab manapun yang sedang dibuka, dengan animasi fade/slide halus saat muncul & hilang.

**Peningkatan tambahan:**
- **Scene Banner**: bisa diisi "Auto-sembunyi setelah X detik" — kalau diisi, banner otomatis hilang sendiri di layar player tanpa DM perlu klik "Sembunyikan" (kosongkan untuk mode manual seperti biasa).
- **Dialog NPC**: panel DM sekarang menampilkan **riwayat 5 dialog terakhir** dengan tombol "↻ Pakai lagi" untuk cepat mengulang nama & isi dialog NPC yang sama.
- **Handout**: panel DM menampilkan **riwayat 5 dokumen terakhir** yang dikirim, dengan tombol "↻ Kirim lagi" (isi judul, teks, dan gambar otomatis terisi ulang ke form).
- **Quest Tracker**: quest sekarang punya **Prioritas** (Rendah/Sedang/Tinggi) yang ditandai badge warna di kartu quest, dan daftar quest otomatis diurutkan: Aktif dulu, lalu berdasar prioritas tertinggi.
- **Recap**: baik di DM Board maupun sheet player, panel Recap sekarang punya **tombol filter** (Semua / 🎬 Scene / 💬 Dialog / 📜 Quest / 🎁 Handout) supaya gampang menyusuri riwayat satu jenis momen cerita saja.

**Fitur baru babak 2:**
- **Scene + Musik otomatis**: pas menampilkan Scene Banner, DM bisa pilih lagu dari playlist Musik — begitu banner tampil ke semua player, lagunya ikut otomatis diputar bareng.
- **Babak/Chapter di Recap**: DM bisa menandai "Babak 1: Gerbang Hutan", "Babak 2: Reruntuhan Kuno", dst — jadi divider di tengah Recap, memisahkan riwayat cerita jadi babak-babak yang jelas (muncul di DM Board & sheet player).
- **Mood NPC di Dialog**: tiap kali DM "Katakan" dialog, bisa pilih mood NPC (😐 Netral/😄 Senang/😠 Marah/🤨 Curiga/😢 Sedih/😨 Takut) — kotak dialog di layar player berubah warna border & ikon ekspresi sesuai mood, biar lebih hidup.
- **Cliffhanger / Ringkasan Sesi Lalu**: DM bisa nulis 1 paragraf "sebelumnya di sesi ini…" yang otomatis nongol sebagai kotak highlight di paling atas tab Cerita player — pas buat mulai sesi baru.


## 5. Struktur folder
```
dnd-vtt/
├── server.js          # server Express + Socket.io (semua logika real-time)
├── package.json
├── data/
│   └── sessions.json  # penyimpanan sesi (dibuat otomatis)
└── public/
    ├── index.html      # halaman awal: pilih DM / Player, join sesi
    ├── character.html  # form character sheet (player)
    ├── character.js
    ├── dm.html         # DM board (peta, NPC, initiative, log)
    ├── dm.js
    └── style.css       # tema visual bersama
```

## 6. Catatan & batasan (biar tidak kaget)
- Ini alat bantu ringan, bukan pengganti VTT besar (Foundry/Roll20) — token & grid sengaja sederhana.
- Dice roll di log dihitung otomatis (RNG murni, bukan sistem anti-cheat) — cocok untuk main santai dengan sistem kepercayaan seperti biasa.
- Gambar peta disimpan langsung sebagai data di `sessions.json`, jadi hindari upload gambar yang sangat besar (idealnya di bawah beberapa MB) supaya tetap ringan.
- Semua data tersimpan **lokal di komputer DM** — tidak ada server online / cloud, jadi kalau komputer DM mati, sesi berhenti (tapi datanya tetap ada di file `data/sessions.json` untuk dilanjutkan).
