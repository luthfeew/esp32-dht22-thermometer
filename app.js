(() => {
  'use strict';

  /**
   * OPSIONAL: Jika kamu ingin deploy web ini ke Vercel / GitHub Pages
   * supaya langsung terhubung tanpa perlu isi di Pengaturan, tempel URL
   * Google Apps Script (/exec) kamu di sini.
   */
  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxM5JHSqdi9N0BpB0WRbd1P23g-DnJ3IDjv392ycc2BpIOWCQPHxJEklDP9htni4LnZ2Q/exec';

  const STORAGE_KEYS = {
    apiUrl: 'esp32_dht22_api_url',
    refreshMs: 'esp32_dht22_refresh_ms',
    colorScheme: 'color-scheme'
  };

  const state = {
    apiUrl: readStorage(STORAGE_KEYS.apiUrl) || DEFAULT_API_URL,
    refreshMs: Number(readStorage(STORAGE_KEYS.refreshMs) ?? 300000),
    range: '24h',
    readings: [],
    isDemo: false,
    refreshTimerId: null,
    tempChart: null,
    humChart: null
  };

  // Referensi elemen DOM
  const els = {
    statusLine: document.getElementById('statusLine'),
    modeBanner: document.getElementById('modeBanner'),
    modeBannerText: document.getElementById('modeBannerText'),
    bannerConfigBtn: document.getElementById('bannerConfigBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportBtn: document.getElementById('exportBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    syncMeta: document.getElementById('syncMeta'),
    currentTemp: document.getElementById('currentTemp'),
    tempBadge: document.getElementById('tempBadge'),
    tempRangeMeta: document.getElementById('tempRangeMeta'),
    currentHum: document.getElementById('currentHum'),
    humBadge: document.getElementById('humBadge'),
    humRangeMeta: document.getElementById('humRangeMeta'),
    currentHeatIndex: document.getElementById('currentHeatIndex'),
    deviceBadge: document.getElementById('deviceBadge'),
    lastUpdateMeta: document.getElementById('lastUpdateMeta'),
    avgTemp: document.getElementById('avgTemp'),
    countBadge: document.getElementById('countBadge'),
    avgHumMeta: document.getElementById('avgHumMeta'),
    tableSummary: document.getElementById('tableSummary'),
    historyTableBody: document.getElementById('historyTableBody'),
    rangeButtons: Array.from(document.querySelectorAll('.range-btn')),
    settingsDialog: document.getElementById('settingsDialog'),
    settingsForm: document.getElementById('settingsForm'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    apiUrlInput: document.getElementById('apiUrlInput'),
    refreshIntervalSelect: document.getElementById('refreshIntervalSelect'),
    systemThemeLabel: document.getElementById('systemThemeLabel'),
    colorSchemeMeta: document.querySelector('meta[name="color-scheme"]')
  };

  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      if (value === null || value === '') {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    } catch {
      // Abaikan jika penyimpanan browser diblokir
    }
  }

  // ================= TEMA (color-scheme) =================
  function applyColorScheme(value) {
    const normalized = value === 'light' || value === 'dark' ? value : 'light dark';
    if (els.colorSchemeMeta) {
      els.colorSchemeMeta.content = normalized;
    }
    updateSystemThemeLabel();
    updateChartThemeColors();
  }

  function getStoredScheme() {
    const stored = readStorage(STORAGE_KEYS.colorScheme);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  }

  function isEffectiveDark() {
    const stored = getStoredScheme();
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return darkMediaQuery.matches;
  }

  function updateSystemThemeLabel() {
    if (!els.systemThemeLabel) return;
    const osState = darkMediaQuery.matches ? 'Gelap' : 'Terang';
    els.systemThemeLabel.textContent = `Sistem (${osState})`;
  }

  // Sinkronisasi tema antar tab
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.colorScheme) {
      applyColorScheme(event.newValue);
    }
  });

  darkMediaQuery.addEventListener('change', () => {
    updateSystemThemeLabel();
    updateChartThemeColors();
  });

  // ================= MODAL DIALOG & FALLBACK LIGHT-DISMISS =================
  function setupDialog() {
    const dialog = els.settingsDialog;

    // Fallback untuk browser (seperti Safari) yang belum mendukung attribute closedby
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (isDialogContent) return;
        dialog.close();
      });
    }

    const openDialog = () => {
      els.apiUrlInput.value = state.apiUrl;
      els.refreshIntervalSelect.value = String(state.refreshMs);
      const currentScheme = getStoredScheme();
      const radio = els.settingsForm.querySelector(
        `input[name="colorScheme"][value="${currentScheme}"]`
      );
      if (radio) radio.checked = true;
      updateSystemThemeLabel();
      dialog.showModal();
    };

    els.openSettingsBtn.addEventListener('click', openDialog);
    els.bannerConfigBtn.addEventListener('click', openDialog);
    els.closeSettingsBtn.addEventListener('click', () => dialog.close());
    els.cancelSettingsBtn.addEventListener('click', () => dialog.close());

    els.settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = els.apiUrlInput.value.trim();
      const refreshMs = Number(els.refreshIntervalSelect.value);
      const selectedScheme = els.settingsForm.querySelector('input[name="colorScheme"]:checked')?.value || 'system';

      state.apiUrl = url;
      state.refreshMs = Number.isFinite(refreshMs) ? refreshMs : 300000;

      writeStorage(STORAGE_KEYS.apiUrl, state.apiUrl);
      writeStorage(STORAGE_KEYS.refreshMs, String(state.refreshMs));

      if (selectedScheme === 'system') {
        writeStorage(STORAGE_KEYS.colorScheme, null);
        applyColorScheme('light dark');
      } else {
        writeStorage(STORAGE_KEYS.colorScheme, selectedScheme);
        applyColorScheme(selectedScheme);
      }

      dialog.close();
      scheduleAutoRefresh();
      loadData();
    });
  }

  // ================= FORMATTER WAKTU & STATUS =================
  const fullDateFormatter = new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const timeOnlyFormatter = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const shortDateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });

  function formatChartLabel(isoString, range) {
    const date = new Date(isoString);
    if (range === '24h') return timeOnlyFormatter.format(date);
    return shortDateTimeFormatter.format(date);
  }

  function getTempStatus(tempC) {
    if (tempC < 22) return { text: 'Sejuk', cls: 'badge-ok' };
    if (tempC <= 28) return { text: 'Nyaman', cls: 'badge-ok' };
    if (tempC <= 32) return { text: 'Hangat', cls: 'badge-warn' };
    return { text: 'Panas', cls: 'badge-hot' };
  }

  function getHumStatus(hum) {
    if (hum < 40) return { text: 'Kering', cls: 'badge-warn' };
    if (hum <= 65) return { text: 'Ideal', cls: 'badge-ok' };
    return { text: 'Lembap', cls: 'badge-warn' };
  }

  // ================= DEMO DATA GENERATOR =================
  function generateDemoPayload(range) {
    const now = Date.now();
    const stepMs = range === '24h' ? 15 * 60 * 1000 : range === '7d' ? 2 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const totalPoints = range === '24h' ? 96 : range === '7d' ? 84 : 120;
    const readings = [];

    for (let i = totalPoints - 1; i >= 0; i--) {
      const ts = new Date(now - i * stepMs);
      const hour = ts.getHours() + ts.getMinutes() / 60;
      const dailyWave = Math.sin(((hour - 9) / 24) * Math.PI * 2);
      const jitter = Math.sin(i * 1.7) * 0.35;

      const temperature = Number((27.4 + dailyWave * 2.8 + jitter).toFixed(2));
      const humidity = Number((64 - dailyWave * 9 - jitter * 1.8).toFixed(2));
      const heatIndex = Number((temperature + Math.max(0, (humidity - 55) * 0.08)).toFixed(2));

      readings.push({
        timestamp: ts.toISOString(),
        temperature,
        humidity,
        heatIndex,
        device: 'ESP32-Demo'
      });
    }

    const temps = readings.map((r) => r.temperature);
    const hums = readings.map((r) => r.humidity);

    return {
      status: 'ok',
      range,
      count: readings.length,
      latest: readings[readings.length - 1],
      stats: {
        minTemp: Math.min(...temps),
        maxTemp: Math.max(...temps),
        avgTemp: Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2)),
        minHum: Math.min(...hums),
        maxHum: Math.max(...hums),
        avgHum: Number((hums.reduce((a, b) => a + b, 0) / hums.length).toFixed(2))
      },
      readings
    };
  }

  // ================= FETCH DATA =================
  async function loadData() {
    els.refreshBtn.disabled = true;
    els.statusLine.textContent = 'Mengambil data terbaru...';

    if (!state.apiUrl) {
      state.isDemo = true;
      const demoData = generateDemoPayload(state.range);
      showBanner('Mode Demo aktif — hubungkan URL Web App Google Apps Script untuk menampilkan data asli ESP32.');
      renderAll(demoData);
      els.statusLine.textContent = 'Mode Demo (data contoh lokal)';
      els.refreshBtn.disabled = false;
      return;
    }

    try {
      state.isDemo = false;
      const url = new URL(state.apiUrl);
      url.searchParams.set('range', state.range);

      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 'ok') {
        throw new Error(data.message || 'Respons API tidak valid');
      }

      hideBanner();
      renderAll(data);
      els.statusLine.textContent = `Terhubung ke Google Sheets · Disinkronkan ${timeOnlyFormatter.format(new Date())}`;
    } catch (err) {
      console.error('Gagal mengambil data:', err);
      showBanner(`Gagal mengambil data dari Google Sheets (${err.message}). Periksa URL Web App dan akses deployment "Anyone".`);
      els.statusLine.textContent = 'Koneksi bermasalah';
    } finally {
      els.refreshBtn.disabled = false;
    }
  }

  function showBanner(text) {
    els.modeBannerText.textContent = text;
    els.modeBanner.hidden = false;
  }

  function hideBanner() {
    els.modeBanner.hidden = true;
  }

  // ================= RENDER UI =================
  function renderAll(payload) {
    state.readings = Array.isArray(payload.readings) ? payload.readings : [];

    renderKpis(payload);
    renderCharts(state.readings);
    renderTable(state.readings);
  }

  function renderKpis(payload) {
    const latest = payload.latest;
    const stats = payload.stats;

    if (!latest || !stats) {
      els.currentTemp.textContent = '--.- °C';
      els.currentHum.textContent = '--.- %';
      els.currentHeatIndex.textContent = '--.- °C';
      els.avgTemp.textContent = '--.- °C';
      els.tempRangeMeta.textContent = 'Belum ada catatan pada periode ini';
      els.humRangeMeta.textContent = 'Belum ada catatan pada periode ini';
      els.lastUpdateMeta.textContent = 'Pembaruan terakhir: --';
      els.avgHumMeta.textContent = 'Rata-rata kelembapan: -- %';
      els.countBadge.textContent = '0 data';
      els.tempBadge.textContent = '--';
      els.tempBadge.className = 'badge';
      els.humBadge.textContent = '--';
      els.humBadge.className = 'badge';
      return;
    }

    const tempStatus = getTempStatus(latest.temperature);
    const humStatus = getHumStatus(latest.humidity);

    els.currentTemp.textContent = `${latest.temperature.toFixed(1)} °C`;
    els.tempBadge.textContent = tempStatus.text;
    els.tempBadge.className = `badge ${tempStatus.cls}`;
    els.tempRangeMeta.textContent = `Min ${stats.minTemp.toFixed(1)} °C · Maks ${stats.maxTemp.toFixed(1)} °C`;

    els.currentHum.textContent = `${latest.humidity.toFixed(1)} %`;
    els.humBadge.textContent = humStatus.text;
    els.humBadge.className = `badge ${humStatus.cls}`;
    els.humRangeMeta.textContent = `Min ${stats.minHum.toFixed(1)} % · Maks ${stats.maxHum.toFixed(1)} %`;

    els.currentHeatIndex.textContent = `${latest.heatIndex.toFixed(1)} °C`;
    els.deviceBadge.textContent = latest.device || 'ESP32';
    els.lastUpdateMeta.textContent = `Terakhir: ${fullDateFormatter.format(new Date(latest.timestamp))}`;

    els.avgTemp.textContent = `${stats.avgTemp.toFixed(1)} °C`;
    els.countBadge.textContent = `${payload.totalInRange ?? payload.count ?? state.readings.length} data`;
    els.avgHumMeta.textContent = `Rata-rata kelembapan: ${stats.avgHum.toFixed(1)} %`;
  }

  function getChartPalette() {
    const dark = isEffectiveDark();
    return {
      text: dark ? '#9aa7bd' : '#56657c',
      grid: dark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
      tempLine: dark ? '#fb7155' : '#e14b32',
      tempFill: dark ? 'rgba(251, 113, 85, 0.16)' : 'rgba(225, 75, 50, 0.12)',
      heatLine: dark ? '#fbbf24' : '#d97706',
      humLine: dark ? '#38bdf8' : '#0284c7',
      humFill: dark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(2, 132, 199, 0.12)'
    };
  }

  function buildCommonChartOptions(unit, palette) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            color: palette.text,
            boxWidth: 12,
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const val = ctx.parsed.y;
              return `${ctx.dataset.label}: ${val !== null ? val.toFixed(1) : '--'} ${unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: palette.text,
            maxTicksLimit: 7,
            maxRotation: 0
          },
          grid: {
            display: false
          }
        },
        y: {
          ticks: {
            color: palette.text,
            callback(value) {
              return `${value} ${unit}`;
            }
          },
          grid: {
            color: palette.grid
          }
        }
      }
    };
  }

  function renderCharts(readings) {
    if (typeof Chart === 'undefined') return;

    const labels = readings.map((r) => formatChartLabel(r.timestamp, state.range));
    const temps = readings.map((r) => r.temperature);
    const heatIndexes = readings.map((r) => r.heatIndex);
    const hums = readings.map((r) => r.humidity);
    const palette = getChartPalette();

    if (state.tempChart) state.tempChart.destroy();
    if (state.humChart) state.humChart.destroy();

    const tempCtx = document.getElementById('tempChart').getContext('2d');
    state.tempChart = new Chart(tempCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Suhu Aktual',
            data: temps,
            borderColor: palette.tempLine,
            backgroundColor: palette.tempFill,
            borderWidth: 2.2,
            fill: true,
            tension: 0.3,
            pointRadius: readings.length > 60 ? 0 : 2.5,
            pointHoverRadius: 5
          },
          {
            label: 'Terasa Seperti',
            data: heatIndexes,
            borderColor: palette.heatLine,
            borderWidth: 1.6,
            borderDash: [5, 4],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ]
      },
      options: buildCommonChartOptions('°C', palette)
    });

    const humCtx = document.getElementById('humChart').getContext('2d');
    state.humChart = new Chart(humCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Kelembapan',
            data: hums,
            borderColor: palette.humLine,
            backgroundColor: palette.humFill,
            borderWidth: 2.2,
            fill: true,
            tension: 0.3,
            pointRadius: readings.length > 60 ? 0 : 2.5,
            pointHoverRadius: 5
          }
        ]
      },
      options: buildCommonChartOptions('%', palette)
    });
  }

  function updateChartThemeColors() {
    if (state.readings.length > 0) {
      renderCharts(state.readings);
    }
  }

  function renderTable(readings) {
    const tbody = els.historyTableBody;
    tbody.replaceChildren();

    if (!readings.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty-cell';
      td.textContent = 'Belum ada data untuk rentang waktu ini.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      els.tableSummary.textContent = '0 pencatatan';
      return;
    }

    const recent = readings.slice(-50).reverse();
    els.tableSummary.textContent = `Menampilkan ${recent.length} pencatatan terakhir dari ${readings.length} titik data`;

    const fragment = document.createDocumentFragment();
    for (const row of recent) {
      const tr = document.createElement('tr');

      const thTime = document.createElement('th');
      thTime.scope = 'row';
      thTime.textContent = fullDateFormatter.format(new Date(row.timestamp));

      const tdTemp = document.createElement('td');
      tdTemp.textContent = `${row.temperature.toFixed(2)} °C`;

      const tdHum = document.createElement('td');
      tdHum.textContent = `${row.humidity.toFixed(2)} %`;

      const tdHeat = document.createElement('td');
      tdHeat.textContent = `${row.heatIndex.toFixed(2)} °C`;

      const tdDevice = document.createElement('td');
      tdDevice.textContent = row.device || 'ESP32';

      tr.append(thTime, tdTemp, tdHum, tdHeat, tdDevice);
      fragment.appendChild(tr);
    }

    tbody.appendChild(fragment);
  }

  // ================= EXPORT CSV =================
  function exportCsv() {
    if (!state.readings.length) return;

    const header = 'Timestamp,Temperature_C,Humidity_Pct,HeatIndex_C,Device';
    const lines = state.readings.map((r) => [
      r.timestamp,
      r.temperature,
      r.humidity,
      r.heatIndex,
      `"${String(r.device || 'ESP32').replace(/"/g, '""')}"`
    ].join(','));

    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `esp32-suhu-${state.range}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // ================= AUTO-REFRESH =================
  function scheduleAutoRefresh() {
    if (state.refreshTimerId) {
      clearInterval(state.refreshTimerId);
      state.refreshTimerId = null;
    }

    if (state.refreshMs > 0) {
      const minutes = Math.round(state.refreshMs / 60000);
      els.syncMeta.textContent = `Auto-refresh: setiap ${minutes} menit`;
      state.refreshTimerId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          loadData();
        }
      }, state.refreshMs);
    } else {
      els.syncMeta.textContent = 'Auto-refresh: mati (manual)';
    }
  }

  // ================= INISIALISASI =================
  function init() {
    updateSystemThemeLabel();
    setupDialog();

    els.rangeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextRange = btn.dataset.range;
        if (!nextRange || nextRange === state.range) return;

        state.range = nextRange;
        els.rangeButtons.forEach((b) => b.classList.toggle('active', b === btn));
        loadData();
      });
    });

    els.refreshBtn.addEventListener('click', loadData);
    els.exportBtn.addEventListener('click', exportCsv);

    scheduleAutoRefresh();
    loadData();
  }

  init();
})();
