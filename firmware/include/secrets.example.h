#pragma once

// Salin file ini menjadi `secrets.h` di folder yang sama (`firmware/include/secrets.h`)
// lalu isi sesuai WiFi dan URL Google Apps Script kamu.

// 1. Kredensial WiFi (ESP32 hanya mendukung WiFi 2.4 GHz)
#define WIFI_SSID     "NAMA_WIFI_KAMU"
#define WIFI_PASSWORD "PASSWORD_WIFI_KAMU"

// 2. URL Web App dari Google Apps Script (berakhir dengan /exec)
#define GOOGLE_SCRIPT_URL "https://script.google.com/macros/s/GANTI_DENGAN_DEPLOYMENT_ID/exec"

// 3. Token rahasia (harus sama persis dengan API_TOKEN di google-apps-script/Code.gs)
#define API_TOKEN "ganti-dengan-token-rahasia-kamu"

// 4. Nama perangkat / lokasi sensor (bebas, misal "Kamar", "Ruang Tamu")
#define DEVICE_NAME "ESP32-Kamar"
