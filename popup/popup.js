'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let parsedHeaders = [];
let parsedRows    = [];
let mappings      = [];   // [{column, selector}]
let isRunning     = false;
let isPaused      = false;

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fileInput      = $('fileInput');
const dropZone       = $('dropZone');
const fileInfo       = $('fileInfo');
const dataPreview    = $('dataPreview');
const previewHead    = $('previewHead');
const previewBody    = $('previewBody');
const rowCount       = $('rowCount');
const mappingList    = $('mappingList');
const addMappingBtn  = $('addMapping');
const submitSelector = $('submitSelector');
const finishSelector = $('finishSelector');
const delayMs        = $('delayMs');
const delayRow       = $('delayRow');
const startRow       = $('startRow');
const progressBar    = $('progressBar');
const progressText   = $('progressText');
const currentRowInfo = $('currentRowInfo');
const btnStart       = $('btnStart');
const btnPause       = $('btnPause');
const btnStop        = $('btnStop');
const statusBadge    = $('statusBadge');
const logEl          = $('log');

// ── CSV Parser ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  return lines.map(line => {
    const row = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { row.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    row.push(cur);
    return row;
  });
}

function parseExcel(buffer) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Excel destegi icin lib/xlsx.min.js gerekli. setup.sh dosyasini calistirin.');
  }
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function loadRows(rows) {
  if (!rows || rows.length < 2) { logMsg('Dosya bos veya sadece baslik satiri var.', 'error'); return; }
  parsedHeaders = rows[0].map(h => String(h).trim());
  parsedRows    = rows.slice(1).filter(r => r.some(c => c !== '' && c != null));
  renderPreview();
  if (mappings.length === 0) mappings = parsedHeaders.map(h => ({ column: h, selector: '' }));
  renderMappings();
  startRow.max   = parsedRows.length;
  startRow.value = 1;
  saveConfig();
  logMsg(`${parsedRows.length} satir yuklendi.`, 'success');
}

// ── File handling ──────────────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  const name = file.name;
  if (!/\.(csv|xlsx?)$/i.test(name)) { logMsg('Desteklenmeyen format. CSV veya Excel kullanin.', 'error'); return; }
  fileInfo.textContent = name;
  fileInfo.classList.remove('hidden');

  const reader = new FileReader();
  if (/\.csv$/i.test(name)) {
    reader.onload = e => { try { loadRows(parseCSV(e.target.result)); } catch (err) { logMsg('CSV hatasi: ' + err.message, 'error'); } };
    reader.readAsText(file, 'UTF-8');
  } else {
    reader.onload = e => { try { loadRows(parseExcel(e.target.result)); } catch (err) { logMsg(err.message, 'error'); } };
    reader.readAsArrayBuffer(file);
  }
}

fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });

// ── Preview ────────────────────────────────────────────────────────────────
function renderPreview() {
  previewHead.innerHTML = '';
  previewBody.innerHTML = '';

  const headRow = document.createElement('tr');
  parsedHeaders.forEach(h => { const th = document.createElement('th'); th.textContent = h; headRow.appendChild(th); });
  previewHead.appendChild(headRow);

  parsedRows.slice(0, 5).forEach(row => {
    const tr = document.createElement('tr');
    parsedHeaders.forEach((_, i) => { const td = document.createElement('td'); td.textContent = row[i] ?? ''; tr.appendChild(td); });
    previewBody.appendChild(tr);
  });

  rowCount.textContent = `${parsedRows.length} kayit${parsedRows.length > 5 ? ' (ilk 5 gosteriliyor)' : ''}`;
  dataPreview.classList.remove('hidden');
}

// ── Mapping ────────────────────────────────────────────────────────────────
function renderMappings() {
  mappingList.innerHTML = '';
  if (parsedHeaders.length === 0) {
    mappingList.innerHTML = '<div class="empty-hint">Once veri dosyasi yukleyin</div>';
    return;
  }
  mappings.forEach((m, idx) => addMappingRow(idx, m));
}

function addMappingRow(idx, m) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.dataset.idx = idx;

  const colSel = document.createElement('select');
  colSel.className = 'input';
  parsedHeaders.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h; opt.textContent = h;
    if (h === m.column) opt.selected = true;
    colSel.appendChild(opt);
  });
  colSel.addEventListener('change', () => { mappings[idx].column = colSel.value; saveConfig(); });

  const arrow = document.createElement('span');
  arrow.className = 'mapping-arrow';
  arrow.textContent = '→';

  const selectorInput = document.createElement('input');
  selectorInput.type = 'text';
  selectorInput.className = 'input';
  selectorInput.placeholder = 'CSS secici';
  selectorInput.value = m.selector;
  selectorInput.addEventListener('input', () => {
    mappings[idx].selector = selectorInput.value;
    saveConfig();
    highlightOnPage(selectorInput.value);
  });

  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'btn btn-icon inspect-btn';
  inspectBtn.title = 'Sayfadan sec';
  inspectBtn.textContent = '⊕';
  inspectBtn.addEventListener('click', () => triggerInspector(selectorInput, idx));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-icon';
  removeBtn.title = 'Kaldir';
  removeBtn.textContent = 'x';
  removeBtn.style.color = '#EF4444';
  removeBtn.addEventListener('click', () => { mappings.splice(idx, 1); renderMappings(); saveConfig(); });

  row.append(colSel, arrow, selectorInput, inspectBtn, removeBtn);
  mappingList.appendChild(row);
}

addMappingBtn.addEventListener('click', () => {
  if (parsedHeaders.length === 0) { logMsg('Once veri dosyasi yukleyin.', 'error'); return; }
  mappings.push({ column: parsedHeaders[0], selector: '' });
  addMappingRow(mappings.length - 1, mappings[mappings.length - 1]);
  saveConfig();
});

// ── Inspector ──────────────────────────────────────────────────────────────
async function triggerInspector(inputEl, mappingIdx) {
  inputEl.value = '...seciliyor';
  inputEl.style.borderColor = '#F59E0B';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Aktif sekme bulunamadi');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECTOR' });
    if (response?.success) {
      inputEl.value = response.selector;
      inputEl.style.borderColor = '#10B981';
      if (mappingIdx >= 0) mappings[mappingIdx].selector = response.selector;
      saveConfig();
      logMsg('Secici: ' + response.selector, 'success');
    }
  } catch (err) {
    inputEl.value = '';
    inputEl.style.borderColor = '';
    logMsg('Sayfa hazir degil. Hedef siteye gidin.', 'error');
  }
}

// Inspect buttons for submit / finish selectors
document.querySelectorAll('.inspect-btn[data-target]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const targetEl = $(btn.dataset.target);
    await triggerInspector(targetEl, -1);
  });
});

submitSelector.addEventListener('input', () => saveConfig());
finishSelector.addEventListener('input', () => saveConfig());

async function highlightOnPage(selector) {
  if (!selector) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT', selector }).catch(() => {});
  } catch (_) {}
}

// ── Wait mode toggle ───────────────────────────────────────────────────────
document.querySelectorAll('input[name="waitMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    delayRow.style.display = radio.value === 'delay' ? 'flex' : 'none';
    saveConfig();
  });
});

// ── Storage ────────────────────────────────────────────────────────────────
function buildConfig() {
  const waitMode = document.querySelector('input[name="waitMode"]:checked')?.value || 'delay';
  return {
    mappings:       mappings.filter(m => m.selector && m.column),
    submitSelector: submitSelector.value.trim(),
    finishSelector: finishSelector.value.trim(),
    delay:          parseInt(delayMs.value) || 1500,
    waitMode,
    totalRows:      parsedRows.length,
    rows:           parsedRows,
    headers:        parsedHeaders
  };
}

function saveConfig() {
  chrome.storage.local.set({
    keyactivity_headers: parsedHeaders,
    keyactivity_rows:    parsedRows,
    keyactivity_config:  buildConfig()
  });
}

async function loadFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'keyactivity_headers', 'keyactivity_rows', 'keyactivity_config',
      'keyactivity_running', 'keyactivity_currentRow'
    ], data => {
      if (data.keyactivity_headers) parsedHeaders = data.keyactivity_headers;
      if (data.keyactivity_rows)    parsedRows    = data.keyactivity_rows;
      if (data.keyactivity_config) {
        const cfg = data.keyactivity_config;
        mappings = cfg.mappings || [];
        submitSelector.value = cfg.submitSelector || '';
        finishSelector.value = cfg.finishSelector || '';
        delayMs.value = cfg.delay || 1500;
        const wm = cfg.waitMode || 'delay';
        const radio = document.querySelector(`input[name="waitMode"][value="${wm}"]`);
        if (radio) { radio.checked = true; delayRow.style.display = wm === 'navigation' ? 'none' : 'flex'; }
      }
      if (parsedHeaders.length > 0) { renderPreview(); renderMappings(); }
      if (data.keyactivity_running) {
        isRunning = true;
        setUIRunning(true);
        updateProgress(data.keyactivity_currentRow || 0, parsedRows.length);
      }
      resolve();
    });
  });
}

// ── Automation control ─────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  if (parsedRows.length === 0) { logMsg('Once veri dosyasi yukleyin.', 'error'); switchTab('data'); return; }
  const cfg = buildConfig();
  if (cfg.mappings.length === 0) { logMsg('En az bir alan eslemesi tanimlayin.', 'error'); switchTab('mapping'); return; }

  const from = Math.max(0, parseInt(startRow.value) - 1);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Aktif sekme bulunamadi');

    const ping = await chrome.tabs.sendMessage(tab.id, { type: 'PING' }).catch(() => null);
    if (!ping?.success) { logMsg('Sayfa hazir degil. Sayfayi yenileyin ve tekrar deneyin.', 'error'); return; }

    isRunning = true; isPaused = false;
    setUIRunning(true);
    chrome.storage.local.set({ keyactivity_running: true, keyactivity_currentRow: from, keyactivity_targetTab: tab.id });
    logMsg(`Otomasyon basladi. ${from + 1}. satirdan itibaren.`, 'info');

    chrome.tabs.sendMessage(tab.id, { type: 'START', config: cfg, startRow: from });
  } catch (err) {
    logMsg('Hata: ' + err.message, 'error');
    isRunning = false;
    setUIRunning(false);
  }
});

btnPause.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    if (!isPaused) {
      chrome.tabs.sendMessage(tab.id, { type: 'PAUSE' }).catch(() => {});
      isPaused = true;
      btnPause.textContent = 'Devam';
      statusBadge.textContent = 'Duraklatildi';
      statusBadge.className = 'badge badge-paused';
    } else {
      chrome.tabs.sendMessage(tab.id, { type: 'RESUME' }).catch(() => {});
      isPaused = false;
      btnPause.textContent = 'Duraklat';
      statusBadge.textContent = 'Calisiyor';
      statusBadge.className = 'badge badge-running';
    }
  } catch (_) {}
});

btnStop.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP' }).catch(() => {});
  } catch (_) {}
  stopAutomation('Durduruldu.');
});

function stopAutomation(msg) {
  isRunning = false; isPaused = false;
  setUIRunning(false);
  chrome.storage.local.set({ keyactivity_running: false });
  if (msg) logMsg(msg, 'info');
}

function setUIRunning(running) {
  btnStart.disabled  = running;
  btnPause.disabled  = !running;
  btnStop.disabled   = !running;
  statusBadge.textContent = running ? 'Calisiyor' : 'Bekleniyor';
  statusBadge.className   = running ? 'badge badge-running' : 'badge badge-idle';
  if (!running) btnPause.textContent = 'Duraklat';
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = `${current} / ${total}`;
}

// ── Messages from content.js ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'PROGRESS') {
    updateProgress(msg.current, msg.total);
    currentRowInfo.textContent = `Satir ${msg.current}: ${msg.preview || ''}`;
    currentRowInfo.classList.remove('hidden');
    chrome.storage.local.set({ keyactivity_currentRow: msg.current });
  }
  if (msg.type === 'ROW_DONE') {
    logMsg(`Satir ${msg.rowIndex + 1} girildi.`, 'success');
  }
  if (msg.type === 'DONE') {
    updateProgress(msg.total, msg.total);
    stopAutomation();
    statusBadge.textContent = 'Tamamlandi';
    statusBadge.className = 'badge badge-done';
    logMsg(`Tum ${msg.total} kayit girildi!`, 'success');
    currentRowInfo.textContent = 'Tamamlandi!';
  }
  if (msg.type === 'ERROR') {
    logMsg('Hata: ' + msg.error, 'error');
    if (msg.fatal) stopAutomation();
  }
});

// ── Tabs ───────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${name}`);
    c.classList.toggle('hidden', c.id !== `tab-${name}`);
  });
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

// ── Init ───────────────────────────────────────────────────────────────────
loadFromStorage();

// Poll progress while running
setInterval(() => {
  if (!isRunning) return;
  chrome.storage.local.get(['keyactivity_currentRow', 'keyactivity_running'], data => {
    if (!data.keyactivity_running) { isRunning = false; setUIRunning(false); return; }
    updateProgress(data.keyactivity_currentRow || 0, parsedRows.length);
  });
}, 600);

function logMsg(text, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${t}] ${text}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}
