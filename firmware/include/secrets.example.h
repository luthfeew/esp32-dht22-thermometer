#pragma once
#include <stddef.h>

// Salin file ini menjadi `secrets.h` di folder yang sama (`firmware/include/secrets.h`)
// lalu isi sesuai daftar WiFi dan URL Google Apps Script kamu.

struct WifiCredential {
  const char *ssid;
  const char *password;
};

// 1. Daftar WiFi utama (ESP32 hanya mendukung WiFi 2.4 GHz).
//    ESP32 otomatis memilih sinyal terkuat yang tersedia dari daftar ini.
static const WifiCredential PRESET_WIFIS[] = {
  {"WIFI_RUMAH", "PASSWORD_WIFI_RUMAH"},
  {"WIFI_KANTOR", "PASSWORD_WIFI_KANTOR"},
};
static constexpr size_t PRESET_WIFI_COUNT = sizeof(PRESET_WIFIS) / sizeof(PRESET_WIFIS[0]);

// 2. URL Web App dari Google Apps Script (berakhir dengan /exec)
#define GOOGLE_SCRIPT_URL "https://script.google.com/macros/s/GANTI_DENGAN_DEPLOYMENT_ID/exec"

// 3. Token rahasia (harus sama persis dengan API_TOKEN di google-apps-script/Code.gs)
#define API_TOKEN "ganti-dengan-token-rahasia-kamu"

// 4. Nama perangkat / lokasi sensor bawaan (bisa diubah juga lewat portal WiFi HP)
#define DEVICE_NAME "ESP32-Kamar"
