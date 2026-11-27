(() => {
  'use strict';

  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxM5JHSqdi9N0BpB0WRbd1P23g-DnJ3IDjv392ycc2BpIOWCQPHxJEklDP9htni4LnZ2Q/exec';
  const DEMO_SENTINEL = '__demo__';
  const VALID_RANGES = new Set(['24h', '7d', '30d', 'all']);
  const RANGE_LABELS = {
    '24h': '24 Jam',
    '7d': '7 Hari',
    '30d': '30 Hari',
    'all': 'Semua'
  };

  // Ambang batas zona nyaman (suhu kamar & kelembapan relatif)
  const COMFORT = {
    tempMin: 22,
    tempMax: 28,
    humMin: 40,
    humMax: 65,
    staleMinutes: 15,
    offlineMinutes: 60
  };

  const STORAGE_KEYS = {
    apiUrl: 'esp32_dht22_api_url',
    sheetUrl: 'esp32_dht22_sheet_url',
    range: 'esp32_dht22_range',
    refreshMs: 'esp32_dht22_refresh_ms',
    colorScheme: 'color-scheme'
  };

  function resolveInitialApiUrl() {
    const stored = readStorage(STORAGE_KEYS.apiUrl);
    if (stored === DEMO_SENTINEL) return '';
    if (stored) return stored;
    return DEFAULT_API_URL;
  }

  function resolveInitialRange() {
    const stored = readStorage(STORAGE_KEYS.range);
    return VALID_RANGES.has(stored) ? stored : '24h';
  }

  const state = {
    apiUrl: resolveInitialApiUrl(),
    sheetUrl: readStorage(STORAGE_KEYS.sheetUrl) || '',
    refreshMs: Number(readStorage(STORAGE_KEYS.refreshMs) ?? 300000),
    range: resolveInitialRange(),
    readings: [],
    isDemo: false,
    refreshTimerId: null,
    toastTimerId: null,
    activeController: null,
    tempChart: null,
    humChart: null
  };

  const els = {
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    modeBanner: document.getElementById('modeBanner'),
    modeBannerText: document.getElementById('modeBannerText'),
    bannerPrimaryBtn: document.getElementById('bannerPrimaryBtn'),
    bannerSecondaryBtn: document.getElementById('bannerSecondaryBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportBtn: document.getElementById('exportBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    nowPanel: document.getElementById('nowPanel'),
    comfortVerdict: document.getElementById('comfortVerdict'),
    currentTemp: document.getElementById('currentTemp'),
    tempBadge: document.getElementById('tempBadge'),
    currentHum: document.getElementById('currentHum'),
    humBadge: document.getElementById('humBadge'),
    currentHeatIndex: document.getElementById('currentHeatIndex'),
    lastReadingMeta: document.getElementById('lastReadingMeta'),
    syncMeta: document.getElementById('syncMeta'),
    sheetLink: document.getElementById('sheetLink'),
    periodTempLabel: document.getElementById('periodTempLabel'),
    periodTempSummary: document.getElementById('periodTempSummary'),
    periodHumLabel: document.getElementById('periodHumLabel'),
    periodHumSummary: document.getElementById('periodHumSummary'),
    periodCountSummary: document.getElementById('periodCountSummary'),
    tempSkeleton: document.getElementById('tempSkeleton'),
    humSkeleton: document.getElementById('humSkeleton'),
    tempEmpty: document.getElementById('tempEmpty'),
    humEmpty: document.getElementById('humEmpty'),
    tableSummary: document.getElementById('tableSummary'),
    historyTableBody: document.getElementById('historyTableBody'),
    rangeButtons: Array.from(document.querySelectorAll('.range-btn')),
    settingsDialog: document.getElementById('settingsDialog'),
    settingsForm: document.getElementById('settingsForm'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    apiUrlInput: document.getElementById('apiUrlInput'),
    apiUrlError: document.getElementById('apiUrlError'),
    useDefaultUrlBtn: document.getElementById('useDefaultUrlBtn'),
    sheetUrlInput: document.getElementById('sheetUrlInput'),
    refreshIntervalSelect: document.getElementById('refreshIntervalSelect'),
    systemThemeLabel: document.getElementById('systemThemeLabel'),
    themeRadios: Array.from(document.querySelectorAll('input[name="colorScheme"]')),
    colorSchemeMeta: document.querySelector('meta[name="color-scheme"]'),
    toast: document.getElementById('toast')
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

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    if (state.toastTimerId) clearTimeout(state.toastTimerId);
    state.toastTimerId = setTimeout(() => {
      els.toast.hidden = true;
    }, 3200);
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

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.colorScheme) {
      applyColorScheme(event.newValue);
    }
  });

  darkMediaQuery.addEventListener('change', () => {
    updateSystemThemeLabel();
    updateChartThemeColors();
  });

  // ================= FORMATTER WAKTU WIB & KESEGARAN SENSOR =================
  const fullDateFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const timeOnlyFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit'
  });

  const shortDateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
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

  function formatRelativeAge(ageMinutes) {
    if (ageMinutes < 1) return 'baru saja';
    if (ageMinutes < 60) return `${Math.round(ageMinutes)} menit lalu`;
    const hours = Math.round(ageMinutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    const days = Math.round(hours / 24);
    return `${days} hari lalu`;
  }

  function evaluateFreshness(latest) {
    if (!latest) {
      return {
        state: 'offline',
        ageText: 'belum ada data',
        timeText: '--'
      };
    }
    const tsMs = new Date(latest.timestamp).getTime();
    const ageMinutes = Math.max(0, (Date.now() - tsMs) / 60000);
    const timeStr = `${timeOnlyFormatter.format(new Date(tsMs))}\u00A0WIB`;

    if (ageMinutes <= COMFORT.staleMinutes) {
      return { state: 'live', ageMinutes, ageText: formatRelativeAge(ageMinutes), timeText: timeStr };
    }
    if (ageMinutes <= COMFORT.offlineMinutes) {
      return { state: 'stale', ageMinutes, ageText: formatRelativeAge(ageMinutes), timeText: timeStr };
    }
    return { state: 'offline', ageMinutes, ageText: formatRelativeAge(ageMinutes), timeText: timeStr };
  }

  function setStatusIndicator(mode, text) {
    els.statusDot.className = 'status-dot';
    if (mode === 'live') els.statusDot.classList.add('is-live');
    else if (mode === 'stale') els.statusDot.classList.add('is-stale');
    else if (mode === 'offline') els.statusDot.classList.add('is-offline');
    else if (mode === 'demo') els.statusDot.classList.add('is-demo');
    els.statusText.textContent = text;
  }

  // ================= STATUS KENYAMANAN RUANGAN =================
  function getTempStatus(tempC) {
    if (tempC < COMFORT.tempMin) return { text: 'Sejuk', cls: 'badge-ok' };
    if (tempC <= COMFORT.tempMax) return { text: 'Nyaman', cls: 'badge-ok' };
    if (tempC <= 32) return { text: 'Hangat', cls: 'badge-warn' };
    return { text: 'Panas', cls: 'badge-hot' };
  }

  function getHumStatus(hum) {
    if (hum < COMFORT.humMin) return { text: 'Kering', cls: 'badge-warn' };
    if (hum <= COMFORT.humMax) return { text: 'Ideal', cls: 'badge-ok' };
    return { text: 'Lembap', cls: 'badge-warn' };
  }

  function buildComfortVerdict(tempC, hum, freshnessState, isDemo) {
    if (isDemo) {
      return 'Pratinjau Mode Demo — hubungkan sensor untuk memantau kamar asli';
    }
    const t = getTempStatus(tempC).text;
    const h = getHumStatus(hum).text;

    let base;
    if ((t === 'Nyaman' || t === 'Sejuk') && h === 'Ideal') {
      base = `Ruangan ${t.toLowerCase()} & kelembapan ideal`;
    } else if (t === 'Panas' || t === 'Hangat') {
      base = h === 'Ideal'
        ? `Ruangan terasa ${t.toLowerCase()} (di atas 28 °C)`
        : `Ruangan ${t.toLowerCase()} & ${h.toLowerCase()}`;
    } else {
      base = `Suhu ${t.toLowerCase()}, kelembapan ${h.toLowerCase()}`;
    }

    if (freshnessState === 'offline') {
      return `${base} (data lama — sensor sedang tidak aktif)`;
    }
    if (freshnessState === 'stale') {
      return `${base} (pembaruan sensor tertunda)`;
    }
    return base;
  }

  // ================= BANNER & EMPTY/ERROR ACTIONS =================
  function showBanner({ text, isError = false, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
    els.modeBanner.classList.toggle('is-error', isError);
    els.modeBanner.setAttribute('role', isError ? 'alert' : 'status');
    els.modeBannerText.textContent = text;

    els.bannerPrimaryBtn.textContent = primaryLabel;
    els.bannerPrimaryBtn.onclick = onPrimary;

    if (secondaryLabel && onSecondary) {
      els.bannerSecondaryBtn.textContent = secondaryLabel;
      els.bannerSecondaryBtn.onclick = onSecondary;
      els.bannerSecondaryBtn.hidden = false;
    } else {
      els.bannerSecondaryBtn.hidden = true;
      els.bannerSecondaryBtn.onclick = null;
    }

    els.modeBanner.hidden = false;
  }

  function hideBanner() {
    els.modeBanner.hidden = true;
  }

  function switchRange(nextRange) {
    if (!VALID_RANGES.has(nextRange) || nextRange === state.range) return;
    state.range = nextRange;
    writeStorage(STORAGE_KEYS.range, nextRange);
    syncRangeButtons();
    loadData();
  }

  function syncRangeButtons() {
    els.rangeButtons.forEach((btn) => {
      const isActive = btn.dataset.range === state.range;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function updateSheetLink() {
    if (!els.sheetLink) return;
    if (state.sheetUrl) {
      els.sheetLink.href = state.sheetUrl;
      els.sheetLink.hidden = false;
    } else {
      els.sheetLink.hidden = true;
      els.sheetLink.removeAttribute('href');
    }
  }

  // ================= MODAL PENGATURAN =================
  function setupDialog() {
    const dialog = els.settingsDialog;

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
      els.sheetUrlInput.value = state.sheetUrl;
      els.refreshIntervalSelect.value = String(state.refreshMs);
      els.apiUrlError.hidden = true;
      els.useDefaultUrlBtn.hidden = !DEFAULT_API_URL || state.apiUrl === DEFAULT_API_URL;

      const currentScheme = getStoredScheme();
      const radio = els.settingsForm.querySelector(
        `input[name="colorScheme"][value="${currentScheme}"]`
      );
      if (radio) radio.checked = true;
      updateSystemThemeLabel();
      dialog.showModal();
    };

    els.themeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        if (radio.value === 'system') {
          writeStorage(STORAGE_KEYS.colorScheme, null);
          applyColorScheme('light dark');
        } else {
          writeStorage(STORAGE_KEYS.colorScheme, radio.value);
          applyColorScheme(radio.value);
        }
      });
    });

    els.useDefaultUrlBtn.addEventListener('click', () => {
      els.apiUrlInput.value = DEFAULT_API_URL;
      els.apiUrlError.hidden = true;
      els.useDefaultUrlBtn.hidden = true;
    });

    els.openSettingsBtn.addEventListener('click', openDialog);
    els.closeSettingsBtn.addEventListener('click', () => dialog.close());
    els.cancelSettingsBtn.addEventListener('click', () => dialog.close());

    els.settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = els.apiUrlInput.value.trim();
      const sheetUrl = els.sheetUrlInput.value.trim();

      if (url && !/^https:\/\/script\.google\.com\/.+\/exec$/i.test(url)) {
        els.apiUrlError.textContent = 'URL harus dimulai dengan https://script.google.com/ dan diakhiri /exec.';
        els.apiUrlError.hidden = false;
        els.apiUrlInput.focus();
        return;
      }

      if (sheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(sheetUrl)) {
        els.apiUrlError.textContent = 'Tautan Google Sheets harus dimulai dengan https://docs.google.com/spreadsheets/.';
        els.apiUrlError.hidden = false;
        els.sheetUrlInput.focus();
        return;
      }

      els.apiUrlError.hidden = true;

      const apiChanged = url !== state.apiUrl;
      const refreshMs = Number(els.refreshIntervalSelect.value);

      state.apiUrl = url;
      state.sheetUrl = sheetUrl;
      state.refreshMs = Number.isFinite(refreshMs) ? refreshMs : 300000;

      writeStorage(STORAGE_KEYS.apiUrl, url === '' ? DEMO_SENTINEL : url);
      writeStorage(STORAGE_KEYS.sheetUrl, sheetUrl);
      writeStorage(STORAGE_KEYS.refreshMs, String(state.refreshMs));

      updateSheetLink();
      scheduleAutoRefresh();
      dialog.close();

      if (apiChanged) {
        loadData();
      } else {
        showToast('Pengaturan disimpan.');
      }
    });
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

      const temperature = Number((27.4 + dailyWave * 2.8 + jitter).toFixed(1));
      const humidity = Number((64 - dailyWave * 9 - jitter * 1.8).toFixed(1));
      const heatIndex = Number((temperature + Math.max(0, (humidity - 55) * 0.08)).toFixed(1));

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
        avgTemp: Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)),
        minHum: Math.min(...hums),
        maxHum: Math.max(...hums),
        avgHum: Number((hums.reduce((a, b) => a + b, 0) / hums.length).toFixed(1))
      },
      readings
    };
  }

  // ================= FETCH DATA DENGAN ABORTCONTROLLER =================
  function setLoadingState(isLoading) {
    els.nowPanel.dataset.loading = isLoading ? 'true' : 'false';
    els.refreshBtn.disabled = isLoading;
    els.tempSkeleton.hidden = !isLoading;
    els.humSkeleton.hidden = !isLoading;
    if (isLoading) {
      els.tempEmpty.hidden = true;
      els.humEmpty.hidden = true;
      els.exportBtn.disabled = true;
    }
  }

  async function loadData() {
    if (state.activeController) {
      state.activeController.abort();
    }

    const controller = new AbortController();
    state.activeController = controller;

    setLoadingState(true);
    setStatusIndicator('neutral', 'Mengambil data terbaru...');

    if (!state.apiUrl) {
      state.isDemo = true;
      const demoData = generateDemoPayload(state.range);
      setLoadingState(false);
      showBanner({
        text: 'Mode Demo aktif — menampilkan data simulasi agar grafik bisa dicoba.',
        primaryLabel: 'Hubungkan Sensor',
        onPrimary: () => els.openSettingsBtn.click()
      });
      renderAll(demoData);
      setStatusIndicator('demo', 'Mode Demo · Data simulasi lokal');
      return;
    }

    try {
      state.isDemo = false;
      const url = new URL(state.apiUrl);
      url.searchParams.set('range', state.range);

      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 'ok') {
        throw new Error('BAD_PAYLOAD');
      }

      if (controller.signal.aborted) return;

      setLoadingState(false);
      renderAll(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Gagal mengambil data:', err);
      setLoadingState(false);
      setStatusIndicator('offline', 'Gagal terhubung ke sumber data');
      els.comfortVerdict.textContent = 'Data terbaru tidak dapat dimuat';

      showBanner({
        text: 'Koneksi ke Google Sheets bermasalah. Pastikan internet aktif dan URL layanan sudah benar.',
        isError: true,
        primaryLabel: 'Coba Lagi',
        onPrimary: () => loadData(),
        secondaryLabel: 'Pengaturan',
        onSecondary: () => els.openSettingsBtn.click()
      });
    } finally {
      if (state.activeController === controller) {
        state.activeController = null;
      }
    }
  }

  // ================= RENDER SEMUA BAGIAN =================
  function renderAll(payload) {
    state.readings = Array.isArray(payload.readings) ? payload.readings : [];
    els.exportBtn.disabled = state.readings.length === 0;

    renderNowAndFreshness(payload);
    renderPeriodSummary(payload);
    renderCharts(state.readings);
    renderTable(state.readings);
  }

  function renderNowAndFreshness(payload) {
    const latest = payload.latest;

    if (!latest) {
      els.currentTemp.textContent = '--.- °C';
      els.currentHum.textContent = '--.- %';
      els.currentHeatIndex.textContent = '--.- °C';
      els.tempBadge.textContent = '--';
      els.tempBadge.className = 'badge';
      els.humBadge.textContent = '--';
      els.humBadge.className = 'badge';
      els.lastReadingMeta.textContent = 'Belum ada catatan pada periode ini';
      els.comfortVerdict.textContent = `Belum ada data pada rentang ${RANGE_LABELS[state.range]}`;

      if (!state.isDemo) {
        setStatusIndicator('offline', `Belum ada data dalam ${RANGE_LABELS[state.range]}`);
        if (state.range === '24h') {
          showBanner({
            text: 'Tidak ada pencatatan dalam 24 jam terakhir. Periksa daya/WiFi ESP32 atau buka rentang 7 hari.',
            primaryLabel: 'Lihat 7 Hari',
            onPrimary: () => switchRange('7d')
          });
        } else {
          hideBanner();
        }
      }
      return;
    }

    const tempStatus = getTempStatus(latest.temperature);
    const humStatus = getHumStatus(latest.humidity);
    const freshness = evaluateFreshness(latest);
    const deviceLabel = latest.device || 'ESP32';

    els.currentTemp.textContent = `${latest.temperature.toFixed(1)} °C`;
    els.tempBadge.textContent = tempStatus.text;
    els.tempBadge.className = `badge ${tempStatus.cls}`;

    els.currentHum.textContent = `${latest.humidity.toFixed(1)} %`;
    els.humBadge.textContent = humStatus.text;
    els.humBadge.className = `badge ${humStatus.cls}`;

    els.currentHeatIndex.textContent = `${latest.heatIndex.toFixed(1)} °C`;
    els.lastReadingMeta.textContent = `${deviceLabel} · ${fullDateFormatter.format(new Date(latest.timestamp))}\u00A0WIB`;
    els.comfortVerdict.textContent = buildComfortVerdict(
      latest.temperature,
      latest.humidity,
      freshness.state,
      state.isDemo
    );

    if (!state.isDemo) {
      if (freshness.state === 'live') {
        setStatusIndicator('live', `${deviceLabel} · Aktif ${freshness.ageText} (${freshness.timeText})`);
        hideBanner();
      } else if (freshness.state === 'stale') {
        setStatusIndicator('stale', `${deviceLabel} · Tertunda ${freshness.ageText} (${freshness.timeText})`);
        showBanner({
          text: `Data terakhir masuk ${freshness.ageText} (${freshness.timeText}), melewati interval rutin 5 menit.`,
          primaryLabel: 'Segarkan',
          onPrimary: () => loadData()
        });
      } else {
        setStatusIndicator('offline', `${deviceLabel} · Tidak aktif sejak ${freshness.ageText}`);
        showBanner({
          text: `Sensor ${deviceLabel} belum mengirim data lagi sejak ${fullDateFormatter.format(new Date(latest.timestamp))}\u00A0WIB. Periksa kabel atau WiFi ESP32.`,
          isError: true,
          primaryLabel: 'Coba Lagi',
          onPrimary: () => loadData()
        });
      }
    }
  }

  function renderPeriodSummary(payload) {
    const rangeLabel = RANGE_LABELS[state.range];
    els.periodTempLabel.textContent = `Suhu (${rangeLabel})`;
    els.periodHumLabel.textContent = `Kelembapan (${rangeLabel})`;

    const stats = payload.stats;
    if (!stats || state.readings.length === 0) {
      els.periodTempSummary.textContent = 'Min -- · Rata-rata -- · Maks --';
      els.periodHumSummary.textContent = 'Min -- · Rata-rata -- · Maks --';
      els.periodCountSummary.textContent = '0 catatan · --% di zona nyaman';
      return;
    }

    const comfortHits = state.readings.filter((r) => (
      r.temperature >= COMFORT.tempMin &&
      r.temperature <= COMFORT.tempMax &&
      r.humidity >= COMFORT.humMin &&
      r.humidity <= COMFORT.humMax
    )).length;
    const comfortPct = Math.round((comfortHits / state.readings.length) * 100);
    const totalCount = payload.totalInRange ?? payload.count ?? state.readings.length;

    els.periodTempSummary.textContent =
      `Min ${stats.minTemp.toFixed(1)} °C · Rata-rata ${stats.avgTemp.toFixed(1)} °C · Maks ${stats.maxTemp.toFixed(1)} °C`;
    els.periodHumSummary.textContent =
      `Min ${stats.minHum.toFixed(1)}% · Rata-rata ${stats.avgHum.toFixed(1)}% · Maks ${stats.maxHum.toFixed(1)}%`;
    els.periodCountSummary.textContent =
      `${totalCount} catatan · ${comfortPct}% di zona nyaman`;
  }

  // ================= PLUGIN ZONA NYAMAN CHART.JS =================
  const comfortBandPlugin = {
    id: 'comfortBand',
    beforeDatasetsDraw(chart, _args, options) {
      if (!options || !Number.isFinite(options.min) || !Number.isFinite(options.max)) return;
      const { ctx, chartArea, scales } = chart;
      const yScale = scales.y;
      if (!chartArea || !yScale) return;

      const yTop = Math.max(chartArea.top, yScale.getPixelForValue(options.max));
      const yBottom = Math.min(chartArea.bottom, yScale.getPixelForValue(options.min));
      if (yBottom <= yTop) return;

      ctx.save();
      ctx.fillStyle = options.color;
      ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBottom - yTop);
      ctx.restore();
    }
  };

  function getChartPalette() {
    const dark = isEffectiveDark();
    return {
      text: dark ? '#a8a496' : '#59554b',
      grid: dark ? 'rgba(168, 164, 150, 0.14)' : 'rgba(28, 27, 24, 0.08)',
      comfortBand: dark ? 'rgba(82, 184, 172, 0.12)' : 'rgba(28, 100, 92, 0.09)',
      tempLine: dark ? '#f27e63' : '#c6472c',
      tempFill: dark ? 'rgba(242, 126, 99, 0.14)' : 'rgba(198, 71, 44, 0.10)',
      heatLine: dark ? '#e6aa53' : '#9a5b13',
      humLine: dark ? '#59b6df' : '#146c94',
      humFill: dark ? 'rgba(89, 182, 223, 0.14)' : 'rgba(20, 108, 148, 0.10)'
    };
  }

  function showChartFallback(boxEmptyEl, message, allowSwitch7d) {
    boxEmptyEl.querySelector('.chart-empty-text').textContent = message;
    const btn = boxEmptyEl.querySelector('.chart-empty-btn');
    if (allowSwitch7d && state.range === '24h') {
      btn.hidden = false;
      btn.onclick = () => switchRange('7d');
    } else {
      btn.hidden = true;
      btn.onclick = null;
    }
    boxEmptyEl.hidden = false;
  }

  function buildCommonChartOptions(unit, palette, bandMin, bandMax) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        comfortBand: {
          min: bandMin,
          max: bandMax,
          color: palette.comfortBand
        },
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
    if (state.tempChart) {
      state.tempChart.destroy();
      state.tempChart = null;
    }
    if (state.humChart) {
      state.humChart.destroy();
      state.humChart = null;
    }

    if (typeof Chart === 'undefined') {
      showChartFallback(els.tempEmpty, 'Pustaka grafik gagal dimuat (offline). Data terbaru tetap tampil di atas dan di tabel.', false);
      showChartFallback(els.humEmpty, 'Pustaka grafik gagal dimuat (offline). Data terbaru tetap tampil di atas dan di tabel.', false);
      return;
    }

    if (!readings.length) {
      showChartFallback(els.tempEmpty, `Belum ada data suhu pada rentang ${RANGE_LABELS[state.range]}.`, true);
      showChartFallback(els.humEmpty, `Belum ada data kelembapan pada rentang ${RANGE_LABELS[state.range]}.`, true);
      return;
    }

    els.tempEmpty.hidden = true;
    els.humEmpty.hidden = true;

    const labels = readings.map((r) => formatChartLabel(r.timestamp, state.range));
    const temps = readings.map((r) => r.temperature);
    const heatIndexes = readings.map((r) => r.heatIndex);
    const hums = readings.map((r) => r.humidity);
    const palette = getChartPalette();

    const tempCtx = document.getElementById('tempChart').getContext('2d');
    state.tempChart = new Chart(tempCtx, {
      type: 'line',
      plugins: [comfortBandPlugin],
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
      options: buildCommonChartOptions('°C', palette, COMFORT.tempMin, COMFORT.tempMax)
    });

    const humCtx = document.getElementById('humChart').getContext('2d');
    state.humChart = new Chart(humCtx, {
      type: 'line',
      plugins: [comfortBandPlugin],
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
      options: buildCommonChartOptions('%', palette, COMFORT.humMin, COMFORT.humMax)
    });
  }

  function updateChartThemeColors() {
    if (state.readings.length > 0 && els.tempSkeleton.hidden) {
      renderCharts(state.readings);
    }
  }

  function renderTable(readings) {
    const tbody = els.historyTableBody;
    tbody.replaceChildren();

    if (!readings.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty-cell';
      td.textContent = `Belum ada catatan pada rentang ${RANGE_LABELS[state.range]}.`;
      tr.appendChild(td);
      tbody.appendChild(tr);
      els.tableSummary.textContent = '0 pencatatan';
      return;
    }

    const recent = readings.slice(-50).reverse();
    els.tableSummary.textContent =
      `Menampilkan ${recent.length} catatan terakhir (periode ${RANGE_LABELS[state.range]}: ${readings.length} titik data)`;

    const fragment = document.createDocumentFragment();
    for (const row of recent) {
      const tr = document.createElement('tr');

      const thTime = document.createElement('th');
      thTime.scope = 'row';
      thTime.textContent = fullDateFormatter.format(new Date(row.timestamp));

      const tdTemp = document.createElement('td');
      tdTemp.textContent = `${row.temperature.toFixed(1)} °C`;

      const tdHum = document.createElement('td');
      tdHum.textContent = `${row.humidity.toFixed(1)} %`;

      const tdHeat = document.createElement('td');
      tdHeat.textContent = `${row.heatIndex.toFixed(1)} °C`;

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

    const header = 'Timestamp_WIB,Timestamp_UTC,Temperature_C,Humidity_Pct,HeatIndex_C,Device';
    const lines = state.readings.map((r) => [
      `"${fullDateFormatter.format(new Date(r.timestamp))} WIB"`,
      r.timestamp,
      r.temperature.toFixed(1),
      r.humidity.toFixed(1),
      r.heatIndex.toFixed(1),
      `"${String(r.device || 'ESP32').replace(/"/g, '""')}"`
    ].join(','));

    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `esp32-iklim-${state.range}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast(`CSV periode ${RANGE_LABELS[state.range]} diunduh (${state.readings.length} baris).`);
  }

  // ================= AUTO-REFRESH & KEYBOARD SHORTCUTS =================
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

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (els.settingsDialog.open) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      const key = event.key.toLowerCase();
      if (key === 'r') {
        event.preventDefault();
        loadData();
      } else if (key === '1') switchRange('24h');
      else if (key === '2') switchRange('7d');
      else if (key === '3') switchRange('30d');
      else if (key === '4') switchRange('all');
    });
  }

  // ================= INISIALISASI =================
  function init() {
    updateSystemThemeLabel();
    updateSheetLink();
    syncRangeButtons();
    setupDialog();
    setupKeyboardShortcuts();

    els.rangeButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchRange(btn.dataset.range));
    });

    els.refreshBtn.addEventListener('click', loadData);
    els.exportBtn.addEventListener('click', exportCsv);

    scheduleAutoRefresh();
    loadData();
  }

  init();
})();
