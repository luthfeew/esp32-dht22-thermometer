#include <Arduino.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <vector>
#include <algorithm>
#include "secrets.h"

// ================= KONFIGURASI HARDWARE =================
constexpr uint8_t DHT_PIN = 4;        // Sambungkan pin DAT/OUT DHT22 ke GPIO 4
constexpr uint8_t DHT_TYPE = DHT22;   // Modul DHT22 3-pin (sudah ada resistor pull-up)
constexpr uint8_t STATUS_LED_PIN = 2; // LED biru bawaan mayoritas board ESP32 DevKit V1
constexpr uint8_t BOOT_BUTTON_PIN = 0; // Tombol BOOT bawaan ESP32 (aktif LOW)

// ================= KONFIGURASI INTERVAL & PORTAL =================
constexpr unsigned long SEND_INTERVAL_MS = 1UL * 60UL * 1000UL;   // Interval kirim: 1 menit
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 18000UL;        // Batas waktu cari WiFi dikenal
constexpr unsigned long PORTAL_TIMEOUT_MS = 3UL * 60UL * 1000UL;  // Portal mati otomatis 3 menit jika idle
constexpr unsigned long BOOT_HOLD_MS = 3000UL;                    // Tahan tombol BOOT 3 detik untuk paksa portal
constexpr uint8_t MAX_DHT_RETRIES = 3;

constexpr char PORTAL_AP_SSID[] = "ESP32-Thermometer-Setup";
constexpr char NVS_NAMESPACE[] = "thermometer";

DHT dht(DHT_PIN, DHT_TYPE);
Preferences prefs;

String savedSsid;
String savedPass;
String activeDeviceName;

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

void loadConfigFromNvs() {
  prefs.begin(NVS_NAMESPACE, true);
  savedSsid = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");
  activeDeviceName = prefs.getString("device", DEVICE_NAME);
  prefs.end();

  if (activeDeviceName.length() == 0) {
    activeDeviceName = DEVICE_NAME;
  }
}

void saveWifiToNvs(const String &ssid, const String &pass, const String &device) {
  prefs.begin(NVS_NAMESPACE, false);
  if (ssid.length() > 0) {
    prefs.putString("ssid", ssid);
    prefs.putString("pass", pass);
    savedSsid = ssid;
    savedPass = pass;
  }
  if (device.length() > 0) {
    prefs.putString("device", device);
    activeDeviceName = device;
  }
  prefs.end();
}

void clearCustomWifiNvs() {
  prefs.begin(NVS_NAMESPACE, false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();
  savedSsid = "";
  savedPass = "";
}

String htmlEscape(const String &input) {
  String out;
  out.reserve(input.length() + 16);
  for (size_t i = 0; i < input.length(); i++) {
    char c = input[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else if (c == '\'') out += "&#39;";
    else out += c;
  }
  return out;
}

String jsonEscape(const String &input) {
  String out;
  out.reserve(input.length() + 8);
  for (size_t i = 0; i < input.length(); i++) {
    char c = input[i];
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else out += c;
  }
  return out;
}

bool isBootHeldForPortal() {
  if (digitalRead(BOOT_BUTTON_PIN) != LOW) {
    return false;
  }
  unsigned long start = millis();
  while (digitalRead(BOOT_BUTTON_PIN) == LOW) {
    if (millis() - start >= BOOT_HOLD_MS) {
      return true;
    }
    delay(25);
  }
  return false;
}

bool connectKnownWiFi(unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  WiFi.disconnect(false, false);
  WiFi.mode(WIFI_STA);

  WiFiMulti wifiMulti;
  if (savedSsid.length() > 0) {
    wifiMulti.addAP(savedSsid.c_str(), savedPass.c_str());
  }
  for (size_t i = 0; i < PRESET_WIFI_COUNT; i++) {
    if (PRESET_WIFIS[i].ssid != nullptr && PRESET_WIFIS[i].ssid[0] != '\0') {
      wifiMulti.addAP(PRESET_WIFIS[i].ssid, PRESET_WIFIS[i].password);
    }
  }

  Serial.print("[WiFi] Mencari WiFi dikenal (daftar bawaan + tersimpan)");
  unsigned long startAttempt = millis();
  unsigned long bootLowSince = 0;

  while ((millis() - startAttempt) < timeoutMs) {
    if (wifiMulti.run(5000) == WL_CONNECTED) {
      Serial.println();
      Serial.printf("[WiFi] Terhubung ke \"%s\" (RSSI %d dBm) | IP: %s\n",
                    WiFi.SSID().c_str(),
                    WiFi.RSSI(),
                    WiFi.localIP().toString().c_str());
      return true;
    }

    if (digitalRead(BOOT_BUTTON_PIN) == LOW) {
      if (bootLowSince == 0) bootLowSince = millis();
      if (millis() - bootLowSince >= BOOT_HOLD_MS) {
        Serial.println("\n[WiFi] Tombol BOOT ditahan, membatalkan pencarian...");
        return false;
      }
    } else {
      bootLowSince = 0;
    }

    Serial.print(".");
    delay(250);
  }

  Serial.println("\n[WiFi] Tidak ada WiFi dikenal yang terjangkau.");
  return false;
}

struct ScannedNetwork {
  String ssid;
  int32_t rssi;
  bool open;
};

std::vector<ScannedNetwork> scanNearbyNetworks() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(150);

  int count = WiFi.scanNetworks(false, false);
  std::vector<ScannedNetwork> list;

  for (int i = 0; i < count; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0) continue;

    int32_t rssi = WiFi.RSSI(i);
    bool isOpen = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);

    bool merged = false;
    for (size_t j = 0; j < list.size(); j++) {
      if (list[j].ssid == s) {
        if (rssi > list[j].rssi) list[j].rssi = rssi;
        merged = true;
        break;
      }
    }
    if (!merged) {
      list.push_back({s, rssi, isOpen});
    }
  }

  WiFi.scanDelete();

  std::sort(list.begin(), list.end(), [](const ScannedNetwork &a, const ScannedNetwork &b) {
    return a.rssi > b.rssi;
  });

  if (list.size() > 12) {
    list.resize(12);
  }
  return list;
}

String buildPortalPage(const std::vector<ScannedNetwork> &networks) {
  String html;
  html.reserve(4096);
  html += F("<!DOCTYPE html><html lang='id'><head><meta charset='UTF-8'>");
  html += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += F("<title>Setup WiFi ESP32 Thermometer</title><style>");
  html += F("body{font-family:system-ui,-apple-system,sans-serif;background:#f6f5f0;color:#1c1b18;margin:0;padding:16px}");
  html += F(".card{max-width:440px;margin:0 auto;background:#fff;border:1px solid #ddd9ce;border-radius:14px;padding:18px}");
  html += F("h1{font-size:1.2rem;margin:0 0 6px}p{font-size:.9rem;color:#59554b;margin:0 0 14px}");
  html += F("label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px}");
  html += F("input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfc9bc;border-radius:8px;font-size:1rem}");
  html += F(".nets{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}");
  html += F(".net{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid #ddd9ce;border-radius:8px;background:#faf9f5;cursor:pointer;font-size:.9rem;text-align:left}");
  html += F(".btn{width:100%;padding:12px;border:0;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:14px}");
  html += F(".primary{background:#1c645c;color:#fff}.ghost{background:#eeece5;color:#1c1b18}");
  html += F(".chk{display:flex;align-items:center;gap:8px;font-size:.85rem;margin-top:8px;font-weight:400}.chk input{width:auto}");
  html += F("</style></head><body><div class='card'>");
  html += F("<h1>Pengaturan WiFi ESP32</h1>");
  html += F("<p>Pilih WiFi 2.4 GHz di bawah atau ketik manual. Pengaturan tersimpan di memori ESP32.</p>");

  if (!networks.empty()) {
    html += F("<div class='nets'>");
    for (size_t i = 0; i < networks.size(); i++) {
      String escaped = htmlEscape(networks[i].ssid);
      html += F("<button type='button' class='net' onclick=\"document.getElementById('ssid').value=this.dataset.ssid\" data-ssid='");
      html += escaped;
      html += F("'><span>");
      html += escaped;
      html += networks[i].open ? F(" (Terbuka)") : F(" (Terkunci)");
      html += F("</span><span>");
      html += String(networks[i].rssi);
      html += F(" dBm</span></button>");
    }
    html += F("</div>");
  } else {
    html += F("<p><em>Tidak ada jaringan 2.4 GHz terdeteksi saat pemindaian.</em></p>");
  }

  html += F("<form method='POST' action='/save'>");
  html += F("<label for='ssid'>Nama WiFi (SSID)</label>");
  html += F("<input id='ssid' name='ssid' type='text' placeholder='Nama WiFi 2.4 GHz' value='");
  html += htmlEscape(savedSsid);
  html += F("' required>");

  html += F("<label for='pass'>Password WiFi</label>");
  html += F("<input id='pass' name='pass' type='password' placeholder='Kosongkan jika WiFi terbuka'>");
  html += F("<label class='chk'><input type='checkbox' onclick=\"document.getElementById('pass').type=this.checked?'text':'password'\"> Tampilkan password</label>");

  html += F("<label for='device'>Nama Perangkat / Ruangan</label>");
  html += F("<input id='device' name='device' type='text' maxlength='40' value='");
  html += htmlEscape(activeDeviceName);
  html += F("'>");

  html += F("<button type='submit' class='btn primary'>Simpan & Hubungkan</button></form>");

  if (savedSsid.length() > 0) {
    html += F("<form method='POST' action='/reset'><button type='submit' class='btn ghost'>Hapus WiFi Tambahan (Pakai Daftar Bawaan)</button></form>");
  }

  html += F("</div></body></html>");
  return html;
}

void runCaptivePortal() {
  Serial.println("[Portal] Memindai WiFi sekitar sebelum membuka hotspot setup...");
  std::vector<ScannedNetwork> networks = scanNearbyNetworks();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(PORTAL_AP_SSID);
  delay(200);

  IPAddress apIp = WiFi.softAPIP();
  DNSServer dnsServer;
  dnsServer.start(53, "*", apIp);

  WebServer server(80);
  bool portalFinished = false;
  unsigned long lastActivityMs = millis();

  server.on("/", HTTP_GET, [&]() {
    lastActivityMs = millis();
    server.send(200, "text/html", buildPortalPage(networks));
  });

  server.on("/save", HTTP_POST, [&]() {
    lastActivityMs = millis();
    String newSsid = server.arg("ssid");
    String newPass = server.arg("pass");
    String newDevice = server.arg("device");
    newSsid.trim();
    newDevice.trim();

    if (newSsid.length() == 0) {
      server.send(400, "text/plain", "SSID tidak boleh kosong.");
      return;
    }

    saveWifiToNvs(newSsid, newPass, newDevice);

    String okHtml = F("<!DOCTYPE html><html lang='id'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font-family:system-ui;padding:24px;text-align:center'><h2>Tersimpan!</h2><p>ESP32 sedang mencoba terhubung ke <strong>");
    okHtml += htmlEscape(newSsid);
    okHtml += F("</strong> (Perangkat: ");
    okHtml += htmlEscape(activeDeviceName);
    okHtml += F("). Kamu boleh menutup halaman ini.</p></body></html>");

    server.send(200, "text/html", okHtml);
    delay(600);
    portalFinished = true;
  });

  server.on("/reset", HTTP_POST, [&]() {
    lastActivityMs = millis();
    clearCustomWifiNvs();
    server.send(200, "text/html",
                F("<!DOCTYPE html><html lang='id'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font-family:system-ui;padding:24px;text-align:center'><h2>Direset!</h2><p>WiFi tambahan dihapus. ESP32 kembali memakai daftar WiFi bawaan.</p></body></html>"));
    delay(600);
    portalFinished = true;
  });

  server.onNotFound([&]() {
    lastActivityMs = millis();
    server.sendHeader("Location", String("http://") + apIp.toString() + "/", true);
    server.send(302, "text/plain", "");
  });

  server.begin();

  Serial.printf("[Portal] Hotspot aktif: \"%s\" | Buka http://%s\n",
                PORTAL_AP_SSID, apIp.toString().c_str());
  Serial.println("[Portal] Menunggu konfigurasi lewat HP (batas waktu 3 menit)...");

  unsigned long lastBlinkMs = millis();
  bool ledState = false;

  while (!portalFinished && (millis() - lastActivityMs) < PORTAL_TIMEOUT_MS) {
    dnsServer.processNextRequest();
    server.handleClient();

    if (millis() - lastBlinkMs >= 450) {
      lastBlinkMs = millis();
      ledState = !ledState;
      digitalWrite(STATUS_LED_PIN, ledState ? HIGH : LOW);
    }
    delay(10);
  }

  digitalWrite(STATUS_LED_PIN, LOW);
  server.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  delay(200);

  if (!portalFinished) {
    Serial.println("[Portal] Waktu tunggu portal habis. Kembali mencoba daftar WiFi.");
  }
}

bool ensureWiFiReady() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  if (connectKnownWiFi(WIFI_CONNECT_TIMEOUT_MS)) {
    return true;
  }

  runCaptivePortal();
  return connectKnownWiFi(WIFI_CONNECT_TIMEOUT_MS);
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
    delay(2500);
  }

  return false;
}

bool sendToGoogleSheets(float temperatureC, float humidity, float heatIndexC) {
  if (String(GOOGLE_SCRIPT_URL).indexOf("GANTI_DENGAN_DEPLOYMENT_ID") >= 0) {
    Serial.println("[HTTP] URL Google Apps Script belum diisi di firmware/include/secrets.h");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.setTimeout(15000);

  const char *headerKeys[] = {"Location"};
  http.collectHeaders(headerKeys, 1);

  if (!http.begin(client, GOOGLE_SCRIPT_URL)) {
    Serial.println("[HTTP] Gagal menginisialisasi koneksi HTTPS.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"token\":\"" + jsonEscape(String(API_TOKEN)) + "\",";
  payload += "\"device\":\"" + jsonEscape(activeDeviceName) + "\",";
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

  if (!ensureWiFiReady()) {
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
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.println("\n==================================================");
  Serial.println("  ESP32 + DHT22 -> Google Sheets (Hybrid WiFi)   ");
  Serial.println("==================================================");

  loadConfigFromNvs();
  Serial.printf("[Config] Perangkat: %s | WiFi tersimpan: %s\n",
                activeDeviceName.c_str(),
                savedSsid.length() > 0 ? savedSsid.c_str() : "(belum ada)");

  dht.begin();
  delay(2000);

  ensureWiFiReady();
}

void loop() {
  // Tahan tombol BOOT 3 detik kapan saja untuk buka hotspot setup WiFi
  if (isBootHeldForPortal()) {
    Serial.println("[BOOT] Tombol ditahan 3 detik -> membuka portal setup WiFi...");
    blinkLed(5, 60);
    runCaptivePortal();
    connectKnownWiFi(WIFI_CONNECT_TIMEOUT_MS);
    firstSendDone = false; // Segera kirim data dengan pengaturan baru
  }

  unsigned long now = millis();

  if (!firstSendDone || (now - lastSendMs) >= SEND_INTERVAL_MS) {
    firstSendDone = true;
    lastSendMs = now;
    measureAndUpload();
  }

  delay(100);
}
