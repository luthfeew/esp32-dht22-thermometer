/**
 * Google Apps Script — API Logger & History untuk ESP32 + DHT22
 *
 * Cara pasang:
 * 1. Buka Google Sheets baru -> Extensions -> Apps Script
 * 2. Hapus kode default, tempel seluruh isi file ini, lalu klik Save
 * 3. Ganti nilai API_TOKEN di bawah (samakan dengan firmware/include/secrets.h)
 * 4. Klik Deploy -> New deployment -> Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Salin Web App URL (berakhir /exec) ke `firmware/include/secrets.h` dan Web Dashboard
 */

const SHEET_NAME = 'DataSuhu';
const API_TOKEN = 'ganti-dengan-token-rahasia-kamu';
const TIMEZONE = 'Asia/Jakarta';
const DEFAULT_LIMIT = 1500;

/**
 * Menerima data JSON dari ESP32 via HTTP POST dan menyimpannya ke Google Sheets.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'Body request kosong' });
    }

    const body = JSON.parse(e.postData.contents);

    if (body.token !== API_TOKEN) {
      return jsonResponse({ status: 'error', message: 'Token tidak valid' });
    }

    const temperature = Number(body.temperature);
    const humidity = Number(body.humidity);
    const heatIndex = body.heatIndex !== undefined ? Number(body.heatIndex) : temperature;
    const device = String(body.device || 'ESP32').slice(0, 60);

    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
      return jsonResponse({ status: 'error', message: 'Nilai suhu atau kelembapan tidak valid' });
    }

    const sheet = getOrCreateSheet();
    const now = new Date();

    sheet.appendRow([now, temperature, humidity, heatIndex, device]);

    // Format kolom waktu agar rapi dibaca di Google Sheets
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');

    return jsonResponse({
      status: 'ok',
      timestamp: now.toISOString(),
      temperature: temperature,
      humidity: humidity,
      heatIndex: heatIndex,
      device: device,
      row: lastRow
    });
  } catch (err) {
    return jsonResponse({ status: 'error', message: String(err) });
  }
}

/**
 * Mengembalikan data histori dalam format JSON untuk Web Dashboard.
 * Parameter query:
 *   ?range=24h | 7d | 30d | all  (default: 24h)
 *   ?limit=1500                  (opsional, batas jumlah titik data)
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const range = String(params.range || '24h').toLowerCase();
    const limit = Math.min(Math.max(Number(params.limit) || DEFAULT_LIMIT, 10), 5000);

    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return jsonResponse({
        status: 'ok',
        range: range,
        timezone: TIMEZONE,
        count: 0,
        latest: null,
        stats: null,
        readings: []
      });
    }

    const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    const nowMs = Date.now();
    const cutoffMs = getCutoffMs(range, nowMs);

    const filtered = [];
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const ts = row[0] instanceof Date ? row[0] : new Date(row[0]);
      const tsMs = ts.getTime();
      const temp = Number(row[1]);
      const hum = Number(row[2]);
      const hi = Number(row[3]);
      const device = String(row[4] || 'ESP32');

      if (!Number.isFinite(tsMs) || !Number.isFinite(temp) || !Number.isFinite(hum)) {
        continue;
      }
      if (cutoffMs !== null && tsMs < cutoffMs) {
        continue;
      }

      filtered.push({
        timestamp: ts.toISOString(),
        temperature: round2(temp),
        humidity: round2(hum),
        heatIndex: Number.isFinite(hi) ? round2(hi) : round2(temp),
        device: device
      });
    }

    // Jika titik data sangat banyak, ambil sampel merata agar grafik tetap ringan
    const readings = downsampleIfNeeded(filtered, limit);
    const stats = computeStats(filtered);
    const latest = filtered.length > 0 ? filtered[filtered.length - 1] : null;

    return jsonResponse({
      status: 'ok',
      range: range,
      timezone: TIMEZONE,
      totalInRange: filtered.length,
      count: readings.length,
      latest: latest,
      stats: stats,
      readings: readings
    });
  } catch (err) {
    return jsonResponse({ status: 'error', message: String(err) });
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Temperature (°C)', 'Humidity (%)', 'Heat Index (°C)', 'Device']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getCutoffMs(range, nowMs) {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  if (range === '24h') return nowMs - DAY;
  if (range === '7d') return nowMs - 7 * DAY;
  if (range === '30d') return nowMs - 30 * DAY;
  return null; // 'all'
}

function computeStats(rows) {
  if (!rows.length) return null;

  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let sumTemp = 0;
  let minHum = Infinity;
  let maxHum = -Infinity;
  let sumHum = 0;

  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].temperature;
    const h = rows[i].humidity;
    if (t < minTemp) minTemp = t;
    if (t > maxTemp) maxTemp = t;
    sumTemp += t;
    if (h < minHum) minHum = h;
    if (h > maxHum) maxHum = h;
    sumHum += h;
  }

  return {
    minTemp: round2(minTemp),
    maxTemp: round2(maxTemp),
    avgTemp: round2(sumTemp / rows.length),
    minHum: round2(minHum),
    maxHum: round2(maxHum),
    avgHum: round2(sumHum / rows.length)
  };
}

function downsampleIfNeeded(rows, limit) {
  if (rows.length <= limit) return rows;
  const result = [];
  const step = (rows.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) {
    result.push(rows[Math.round(i * step)]);
  }
  return result;
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
