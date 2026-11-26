#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include "secrets.h"

// ================= KONFIGURASI HARDWARE =================
constexpr uint8_t DHT_PIN = 4;        // Sambungkan pin DAT/OUT DHT22 ke GPIO 4
constexpr uint8_t DHT_TYPE = DHT22;   // Modul DHT22 3-pin (sudah ada resistor pull-up)
constexpr uint8_t STATUS_LED_PIN = 2; // LED biru bawaan mayoritas board ESP32 DevKit

// ================= KONFIGURASI INTERVAL =================
constexpr unsigned long SEND_INTERVAL_MS = 5UL * 60UL * 1000UL; // Default: 5 menit
constexpr unsigned long WIFI_RETRY_TIMEOUT_MS = 20000UL;
constexpr uint8_t MAX_DHT_RETRIES = 3;

DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastSendMs = 0;
bool firstSendDone = false;

void blinkLed(uint8_t times, uint16_t durationMs = 120) {
  for (uint8_t i = 0; i < times; i++) {
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(durationMs);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(durationMs);
  }
}

bool ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.print("[WiFi] Menghubungkan ke ");
  Serial.print(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt) < WIFI_RETRY_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Terhubung! IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("[WiFi] Gagal terhubung. Akan dicoba lagi pada siklus berikutnya.");
  return false;
}

bool readDhtSensor(float &temperatureC, float &humidity, float &heatIndexC) {
  for (uint8_t attempt = 1; attempt <= MAX_DHT_RETRIES; attempt++) {
    float h = dht.readHumidity();
    float t = dht.readTemperature(); // Celsius

    if (!isnan(h) && !isnan(t) && h >= 0.0f && h <= 100.0f && t > -40.0f && t < 85.0f) {
      temperatureC = t;
      humidity = h;
      heatIndexC = dht.computeHeatIndex(t, h, false);
      return true;
    }

    Serial.printf("[DHT22] Percobaan %u/%u gagal (NaN). Mengulang...\n", attempt, MAX_DHT_RETRIES);
    delay(2500); // DHT22 membutuhkan jeda minimal ~2 detik antar pembacaan
  }

  return false;
}

bool sendToGoogleSheets(float temperatureC, float humidity, float heatIndexC) {
  if (String(GOOGLE_SCRIPT_URL).indexOf("GANTI_DENGAN_DEPLOYMENT_ID") >= 0) {
    Serial.println("[HTTP] URL Google Apps Script belum diisi di firmware/include/secrets.h");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Sederhana untuk proyek rumahan agar tidak terputus saat rotasi sertifikat Google

  HTTPClient http;
  // Google Apps Script memproses doPost lalu merespons 302 redirect ke URL hasil (GET).
  // Kita matikan auto-redirect saat POST, lalu lakukan GET manual ke header Location untuk verifikasi.
  http.setFollowRedirects(HTTPC_DISABLE_REDIRECTS);
  http.setTimeout(15000);

  const char *headerKeys[] = {"Location"};
  http.collectHeaders(headerKeys, 1);

  if (!http.begin(client, GOOGLE_SCRIPT_URL)) {
    Serial.println("[HTTP] Gagal menginisialisasi koneksi HTTPS.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"token\":\"" + String(API_TOKEN) + "\",";
  payload += "\"device\":\"" + String(DEVICE_NAME) + "\",";
  payload += "\"temperature\":" + String(temperatureC, 2) + ",";
  payload += "\"humidity\":" + String(humidity, 2) + ",";
  payload += "\"heatIndex\":" + String(heatIndexC, 2);
  payload += "}";

  Serial.print("[HTTP] Mengirim data: ");
  Serial.println(payload);

  int httpCode = http.POST(payload);
  String location = http.header("Location");
  String responseBody = http.getString();
  http.end();

  if (httpCode == HTTP_CODE_FOUND || httpCode == HTTP_CODE_MOVED_PERMANENTLY || httpCode == HTTP_CODE_SEE_OTHER) {
    if (location.length() > 0) {
      HTTPClient redirectHttp;
      redirectHttp.setTimeout(15000);
      if (redirectHttp.begin(client, location)) {
        httpCode = redirectHttp.GET();
        responseBody = redirectHttp.getString();
        redirectHttp.end();
      }
    }
  }

  Serial.printf("[HTTP] Status: %d | Respons: %s\n", httpCode, responseBody.c_str());

  if (httpCode == HTTP_CODE_OK && responseBody.indexOf("\"status\":\"ok\"") >= 0) {
    return true;
  }

  return false;
}

void measureAndUpload() {
  float tempC = 0.0f;
  float humidity = 0.0f;
  float heatIndexC = 0.0f;

  if (!readDhtSensor(tempC, humidity, heatIndexC)) {
    Serial.println("[DHT22] Gagal membaca sensor. Periksa kabel VCC (3V3), DAT (GPIO 4), dan GND.");
    blinkLed(3, 80);
    return;
  }

  Serial.printf("[DHT22] Suhu: %.2f °C | Kelembapan: %.2f %% | Terasa seperti: %.2f °C\n",
                tempC, humidity, heatIndexC);

  if (!ensureWiFiConnected()) {
    blinkLed(3, 80);
    return;
  }

  if (sendToGoogleSheets(tempC, humidity, heatIndexC)) {
    Serial.println("[OK] Data berhasil disimpan ke Google Sheets.");
    blinkLed(2, 120);
  } else {
    Serial.println("[ERR] Gagal menyimpan data ke Google Sheets.");
    blinkLed(4, 80);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.println("\n==========================================");
  Serial.println("  ESP32 + DHT22 -> Google Sheets Logger   ");
  Serial.println("==========================================");

  dht.begin();
  delay(2000); // Waktu stabilisasi awal DHT22

  ensureWiFiConnected();
}

void loop() {
  unsigned long now = millis();

  // Kirim 1x langsung saat baru menyala, lalu ulang setiap 5 menit
  if (!firstSendDone || (now - lastSendMs) >= SEND_INTERVAL_MS) {
    firstSendDone = true;
    lastSendMs = now;
    measureAndUpload();
  }

  delay(250);
}
