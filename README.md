# ESP32 + DHT22 Thermometer (Google Sheets + Web Dashboard)

Proyek termometer & pencatat kelembapan menggunakan **ESP32 (Type-C)** dan **modul DHT22 3-pin**. Data dikirim otomatis setiap **1 menit** ke **Google Sheets** dan ditampilkan dalam **Web Dashboard grafik interaktif**.

---

## Struktur Proyek

```text
d:\Project\ESP32\
├── firmware/                      # Project VS Code + PlatformIO untuk ESP32
│   ├── platformio.ini             # Konfigurasi board & library Adafruit DHT
│   ├── include/
│   │   ├── secrets.example.h      # Template kredensial WiFi & Apps Script
│   │   └── secrets.h              # File konfigurasi aktif (di-ignore Git)
│   └── src/
│       └── main.cpp               # Kode utama ESP32
├── google-apps-script/
│   └── Code.gs                    # API POST (ESP32) & GET JSON (Web Dashboard)
└── web/                           # Web Dashboard terpisah (HTML/CSS/JS)
    ├── index.html
    ├── styles.css
    └── app.js
```

---

## 1. Skema Kabel (Wiring)

Modul **DHT22 3-pin** umumnya sudah memiliki resistor pull-up di PCB-nya. Gunakan **3 kabel jumper Female-to-Female**:

| Pin DHT22 (3-pin) | Pin ESP32 |
| :--- | :--- |
| **`VCC`** / **`+`** | **`3V3`** *(jangan pakai 5V/VIN)* |
| **`DAT`** / **`OUT`** / **`S`** | **`GPIO 4`** (`D4`) |
| **`GND`** / **`-`** | **`GND`** |

---

## 2. Setup Google Sheets & Apps Script

1. Buka [Google Sheets](https://sheets.google.com) dan buat spreadsheet baru (misal beri nama `Histori Suhu ESP32`).
2. Klik menu **Extensions → Apps Script**.
3. Hapus semua kode bawaan, lalu copy-paste seluruh isi file `google-apps-script/Code.gs`.
4. Ubah baris `API_TOKEN` menjadi token rahasia pilihanmu sendiri, misal:
   ```javascript
   const API_TOKEN = 'suhu-kamar-rahasia-2026';
   ```
5. Klik **Save** (ikon disket / `Ctrl+S`).
6. Klik tombol **Deploy → New deployment**:
   * **Select type:** Web app
   * **Execute as:** Me
   * **Who has access:** Anyone
7. Klik **Deploy**, berikan izin (*Authorize access*) saat diminta, lalu salin **Web app URL** yang berakhiran `/exec`.

> **Catatan:** Jika nanti kamu mengubah kode di `Code.gs`, klik **Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy** agar perubahan aktif.

---

## 3. Setup VS Code + PlatformIO & Upload ke ESP32

1. Di VS Code, buka tab **Extensions** (`Ctrl+Shift+X`), cari dan install **PlatformIO IDE** (oleh PlatformIO). Tunggu instalasi selesai, lalu restart VS Code jika diminta.
2. Buka folder `d:\Project\ESP32\firmware` di VS Code (**File → Open Folder → pilih `firmware`**) supaya ikon Build (✓), Upload (→), dan Serial Monitor (🔌) muncul di status bar bawah VS Code.
3. Edit file `firmware/include/secrets.h`:
   * Isi daftar WiFi pada `PRESET_WIFIS` *(ESP32 hanya mendukung WiFi 2.4 GHz — boleh lebih dari satu)*.
   * Tempel `GOOGLE_SCRIPT_URL` dari langkah 2.
   * Samakan `API_TOKEN` dengan yang ada di `Code.gs`.
4. Hubungkan ESP32 Type-C ke laptop menggunakan **kabel USB data** (disarankan USB-A ke USB-C).
   * Jika port COM belum terdeteksi di Windows Device Manager, install driver chip USB board kamu: biasanya **CP210x** atau **CH340**.
5. Klik tombol **Upload (→)** di bar bawah VS Code.
   * *(Jika proses upload macet di `Connecting...`, tahan tombol **BOOT** di board ESP32 1–2 detik hingga mulai menulis).*
6. Klik tombol **Serial Monitor (🔌)** di bar bawah VS Code untuk melihat log pembacaan suhu & status pengiriman ke Google Sheets.
   * Data pertama langsung dikirim sesaat setelah menyala, lalu otomatis setiap **1 menit**.

### Mode Hybrid WiFi (Pindah-Pindah Lokasi Tanpa Laptop)
* **Otomatis:** ESP32 memindai dan menyambung ke WiFi terkuat yang ada di `PRESET_WIFIS` atau WiFi tambahan yang tersimpan di memori ESP32.
* **Fallback Captive Portal:** Jika tidak ada satu pun WiFi yang cocok, ESP32 otomatis memancarkan hotspot **`ESP32-Thermometer-Setup`**. Sambungkan HP ke hotspot tersebut → isi WiFi baru, password, dan nama ruangan → klik **Simpan & Hubungkan**. (Jika tidak diatur selama 3 menit, hotspot mati otomatis dan mencoba memindai ulang daftar WiFi).
* **Trigger Manual:** Tahan tombol **`BOOT`** pada board ESP32 selama **3 detik** kapan saja untuk membuka portal setup WiFi.

---

## 4. Menjalankan Web Dashboard

### A. Preview Cepat di Laptop (Lokal)
* Kamu bisa langsung membuka file `web/index.html` di browser (atau klik kanan → *Open with Live Server* di VS Code).
* Secara default (jika URL belum diisi), dashboard akan tampil dalam **Mode Demo** supaya kamu bisa langsung melihat tampilannya.
* Klik tombol **Pengaturan** → tempel **Web app URL** (`/exec`) dari Google Apps Script → klik **Simpan & Muat Data**.

### B. Online-kan Gratis (Bisa Dibuka dari HP / Mana Saja)
Jika ingin dibuka dari HP tanpa perlu tempel URL berulang kali:
1. Isi konstanta `DEFAULT_API_URL` di baris paling atas `web/app.js` dengan URL `/exec` kamu.
2. Deploy folder `web/` secara gratis ke **Vercel** atau **GitHub Pages**.

---

## Troubleshooting Singkat

* **`[DHT22] Gagal membaca sensor (NaN)`**: Cek kembali kabel `VCC` ke `3V3`, `DAT` ke `GPIO 4`, dan `GND` ke `GND`. Pastikan pin tidak longgar.
* **WiFi tidak mau terhubung**: Pastikan memakai jaringan **2.4 GHz** (bukan 5 GHz) dan penulisan SSID/password di `PRESET_WIFIS` persis sama. Jika ingin ganti WiFi lewat HP, tahan tombol **`BOOT`** selama **3 detik** lalu sambungkan HP ke hotspot `ESP32-Thermometer-Setup`.
* **Respons `Token tidak valid`**: Pastikan `API_TOKEN` di `firmware/include/secrets.h` sama persis dengan `API_TOKEN` di `Code.gs`.
* **Board ESP32-C3 / ESP32-S3**: Jika board Type-C kamu ternyata varian C3/S3 (bukan ESP32-WROOM-32 standar), ubah `board = esp32dev` di `firmware/platformio.ini` (misal ke `esp32-c3-devkitm-1` atau `esp32-s3-devkitc-1`) dan sesuaikan `DHT_PIN` / `STATUS_LED_PIN`.
