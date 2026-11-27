# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pemilik perangkat pribadi (ESP32 + DHT22) yang memantau suhu dan kelembapan kamar atau ruangan sendiri secara cepat dari HP maupun laptop, baik saat di rumah maupun dari luar rumah.

## Product Purpose

Memantau suhu aktual, kelembapan relatif, dan heat index terkini; meninjau tren histori (24 jam, 7 hari, 30 hari, dan semua waktu); mengetahui status kenyamanan serta peringatan/batas nyaman ketika ruangan terlalu panas atau terlalu lembap; dan mengekspor/mengolah data histori (CSV dan Google Sheets) untuk evaluasi seperti efektivitas pemakaian AC.

## Positioning

Pemantau suhu & kelembapan pribadi yang 100% gratis tanpa server atau cloud berbayar, memadukan hardware DIY (ESP32 DevKit V1 + DHT22), penyimpanan histori milik sendiri di Google Sheets, dan web dashboard statis ringan di GitHub Pages.

## Operating Context

Hardware ESP32 DevKit V1 (USB Type-C, CP2102) + DHT22 3-pin (`GPIO 4`) pada WiFi 2.4 GHz mengirim data setiap 5 menit ke Google Apps Script (`google-apps-script/Code.gs`) dan menyimpannya ke Google Sheets (`DataSuhu`), lalu dibaca oleh dashboard statis (`web/`, Chart.js) yang dipublikasikan di GitHub Pages (`https://luthfeew.github.io/esp32-dht22-thermometer/`). Pengembangan memakai VS Code + PlatformIO (`firmware/`) dan Git/GitHub (`main` + `gh-pages`).

## Capabilities and Constraints

- Wajib tetap sederhana, ringan, dan 100% gratis (static HTML/CSS/JS di GitHub Pages + Google Sheets/Apps Script, tanpa biaya server/cloud).
- Bahasa UI utama: Bahasa Indonesia (`id-ID`, zona waktu `Asia/Jakarta` / WIB).
- Karakteristik hardware: akurasi bawaan DHT22 ±0.5 °C dan ±2–5% RH; interval pencatatan default 5 menit.
- Keamanan: URL Web App `/exec` bersifat publik *read-only* untuk `GET`, sedangkan `API_TOKEN` untuk `POST` tetap rahasia di `firmware/include/secrets.h` (di-ignore Git) dan `Code.gs`.
- Belum ditetapkan (keputusan terbuka): ambang batas peringatan suhu/kelembapan kustom dan mekanisme notifikasi proaktif (di halaman vs kanal luar) untuk pengembangan fitur peringatan batas nyaman.

## Evidence on Hand

- Firmware ESP32 terverifikasi kompilasi PlatformIO (`firmware/src/main.cpp`, `firmware/platformio.ini`).
- Endpoint Google Apps Script (`google-apps-script/Code.gs`) aktif dan sudah menerima data nyata dari perangkat `ESP32-Kamar`.
- Web dashboard statis (`web/index.html`, `web/styles.css`, `web/app.js`) aktif dan dipublikasikan di `https://luthfeew.github.io/esp32-dht22-thermometer/`.
- Tidak ada aset merek/logo khusus, testimoni, atau klaim komersial — tidak boleh dibuat-buat.

## Product Principles

1. Sekilas langsung terbaca: kondisi saat ini, status kenyamanan, dan tren harus cepat dipahami di HP maupun laptop.
2. Ringan dan nol biaya operasional: setiap peningkatan tetap berjalan di arsitektur statis + Google Sheets gratis.
3. Kepemilikan penuh atas data: histori mudah ditinjau, diekspor (CSV / Google Sheets), dan dianalisis untuk evaluasi nyata seperti pemakaian AC.
4. Jujur terhadap keterbatasan perangkat: tampilkan waktu pembaruan terakhir, status koneksi/demo, dan keterbacaan jeda pencatatan 5 menit apa adanya.
