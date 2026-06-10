'use strict';

// ── Module state ───────────────────────────────────────────────────────────
let isRunning  = false;
let isPaused   = false;
let hoveredEl  = null;
let overlayEl  = null;
let styleEl    = null;
let bannerEl   = null;

// ── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg.type) {

    case 'PING':
      respond({ success: true });
      break;

    case 'START':
      isRunning = true;
      isPaused  = false;
      runAutomation(msg.config, msg.startRow || 0)
        .then(() => respond({ success: true }))
        .catch(err => respond({ success: false, error: err.message }));
      return true;

    case 'PAUSE':
      isPaused = true;
      respond({ success: true });
      break;

    case 'RESUME':
      isPaused = false;
      respond({ success: true });
      break;

    case 'STOP':
      isRunning = false;
      respond({ success: true });
      break;

    case 'PAGE_LOADED':
      continueFromStorage()
        .then(() => respond({ success: true }))
        .catch(() => respond({ success: false }));
      return true;

    // Inspector is now fire-and-forget: result goes to storage, not back here
    case 'START_INSPECTOR':
      startInspector();
      respond({ success: true });
      break;

    case 'STOP_INSPECTOR':
      stopInspector();
      respond({ success: true });
      break;

    case 'HIGHLIGHT':
      highlightSelector(msg.selector);
      respond({ success: true });
      break;
  }
});

// ── Main automation loop ───────────────────────────────────────────────────
async function runAutomation(config, startRow) {
  const { rows, headers, mappings, submitSelector, finishSelector,
          preSubmitDelay, delay, waitMode, totalRows } = config;

  for (let i = startRow; i < totalRows; i++) {
    if (!isRunning) break;
    while (isPaused && isRunning) await sleep(150);
    if (!isRunning) break;

    const rowData = {};
    headers.forEach((h, idx) => { rowData[h] = rows[i]?.[idx] ?? ''; });

    notify({ type: 'PROGRESS', current: i + 1, total: totalRows, preview: previewText(rowData) });
    chrome.storage.local.set({ keyactivity_currentRow: i + 1 });

    const fillErrors = await fillForm(rowData, mappings);
    fillErrors.forEach(e => notify({ type: 'ERROR', error: e, fatal: false }));

    // Alanlar doldurulduktan sonra bekle (ör. price → tax otomatik hesaplansın)
    if (preSubmitDelay > 0) await sleep(preSubmitDelay);

    const isLast = (i === totalRows - 1);

    if (isLast && finishSelector) {
      await clickElement(finishSelector, '"Finish" butonu bulunamadi');
    } else if (!isLast && submitSelector) {
      await clickElement(submitSelector, '"Add Another" butonu bulunamadi');
    } else if (!isLast) {
      pressEnter();
    }

    notify({ type: 'ROW_DONE', rowIndex: i });

    if (!isLast) {
      if (waitMode === 'delay') {
        await sleep(delay);
      } else {
        await chrome.storage.local.set({
          keyactivity_running:    true,
          keyactivity_currentRow: i + 1,
          keyactivity_config:     config
        });
        return;
      }
    }
  }

  if (isRunning) {
    isRunning = false;
    await chrome.storage.local.set({ keyactivity_running: false });
    notify({ type: 'DONE', total: totalRows });
  }
}

async function continueFromStorage() {
  const data = await storageGet(['keyactivity_running', 'keyactivity_config', 'keyactivity_currentRow']);
  if (!data.keyactivity_running || !data.keyactivity_config) return;
  const cfg  = data.keyactivity_config;
  const from = data.keyactivity_currentRow || 0;
  if (from >= cfg.totalRows) {
    await chrome.storage.local.set({ keyactivity_running: false });
    notify({ type: 'DONE', total: cfg.totalRows });
    return;
  }
  await sleep(600);
  isRunning = true;
  isPaused  = false;
  await runAutomation(cfg, from);
}

// ── Form filling ───────────────────────────────────────────────────────────
async function fillForm(rowData, mappings) {
  const errors = [];
  for (const { column, selector } of mappings) {
    if (!selector) continue;
    const el = document.querySelector(selector);
    if (!el) { errors.push(`Element bulunamadi: ${selector}`); continue; }
    await fillElement(el, String(rowData[column] ?? ''));
    await sleep(60);
  }
  return errors;
}

async function fillElement(el, value) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();
  await sleep(30);

  const tag  = el.tagName.toUpperCase();
  const type = (el.type || '').toLowerCase();

  if (tag === 'SELECT') {
    const opt = Array.from(el.options).find(o =>
      o.value.toLowerCase() === value.toLowerCase() ||
      o.text.toLowerCase()  === value.toLowerCase() ||
      o.text.toLowerCase().includes(value.toLowerCase())
    );
    if (opt) { el.value = opt.value; fireEvent(el, 'change'); }
  } else if (type === 'checkbox') {
    const checked = ['true','1','yes','evet','var','x'].includes(value.toLowerCase());
    if (el.checked !== checked) { el.checked = checked; fireEvent(el, 'change'); fireEvent(el, 'click'); }
  } else {
    setNativeValue(el, value);
    fireEvent(el, 'input');
    fireEvent(el, 'change');
    fireEvent(el, 'blur');   // tax gibi otomatik hesaplanan alanları tetikler
  }
}

function setNativeValue(el, value) {
  const proto  = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter ? setter.call(el, value) : (el.value = value);
}

function fireEvent(el, name) {
  el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
}

async function clickElement(selector, warnMsg) {
  const el = document.querySelector(selector);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(80);
    el.click();
  } else {
    notify({ type: 'ERROR', error: warnMsg || `Selector bulunamadi: ${selector}`, fatal: false });
  }
}

function pressEnter() {
  const active = document.activeElement;
  if (active) {
    ['keydown','keypress','keyup'].forEach(ev =>
      active.dispatchEvent(new KeyboardEvent(ev, { key: 'Enter', bubbles: true }))
    );
  }
}

// ── Inspector mode ─────────────────────────────────────────────────────────
// Result is written to chrome.storage.local (not sent back via message),
// because the popup closes before the user can click on the page.
function startInspector() {
  stopInspector();

  // Page banner so user knows inspector is active
  bannerEl = document.createElement('div');
  Object.assign(bannerEl.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
    background: '#4F46E5', color: 'white',
    padding: '10px 16px', fontSize: '14px', fontFamily: 'sans-serif',
    fontWeight: '600', textAlign: 'center', letterSpacing: '0.3px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  });
  bannerEl.textContent = 'KeyActivity: Doldurmak istediginiz alana tiklayin  |  Iptal: Esc';
  document.body.appendChild(bannerEl);

  // Full-page transparent overlay
  overlayEl = document.createElement('div');
  Object.assign(overlayEl.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    zIndex: '2147483646', cursor: 'crosshair', background: 'transparent'
  });
  document.body.appendChild(overlayEl);

  // Highlight style
  styleEl = document.createElement('style');
  styleEl.textContent = '._ka_hl { outline: 3px solid #4F46E5 !important; outline-offset: 2px !important; background-color: rgba(79,70,229,0.08) !important; }';
  document.head.appendChild(styleEl);

  const onMove = (e) => {
    if (hoveredEl) hoveredEl.classList.remove('_ka_hl');
    overlayEl.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    overlayEl.style.pointerEvents = '';
    if (under && under !== overlayEl && under !== bannerEl) {
      hoveredEl = under;
      under.classList.add('_ka_hl');
    }
  };

  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    overlayEl.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    overlayEl.style.pointerEvents = '';
    if (!under || under === overlayEl || under === bannerEl) return;

    const selector = generateSelector(under);
    stopInspector();

    // Write result to storage — popup will read it on next open
    await chrome.storage.local.set({
      keyactivity_captured_selector: selector,
      keyactivity_captured_at: Date.now()
    });

    // Brief confirmation flash
    showConfirmFlash(under, selector);
  };

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      stopInspector();
      chrome.storage.local.remove(['keyactivity_captured_selector', 'keyactivity_captured_at']);
    }
  };

  overlayEl.addEventListener('mousemove', onMove);
  overlayEl.addEventListener('click', onClick);
  document.addEventListener('keydown', onEsc, true);

  overlayEl._onMove  = onMove;
  overlayEl._onClick = onClick;
  overlayEl._onEsc   = onEsc;
}

function stopInspector() {
  if (hoveredEl)  { hoveredEl.classList.remove('_ka_hl'); hoveredEl = null; }
  if (overlayEl)  {
    overlayEl.removeEventListener('mousemove', overlayEl._onMove);
    overlayEl.removeEventListener('click',     overlayEl._onClick);
    if (overlayEl._onEsc) document.removeEventListener('keydown', overlayEl._onEsc, true);
    overlayEl.remove(); overlayEl = null;
  }
  if (styleEl)  { styleEl.remove();  styleEl  = null; }
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
}

function showConfirmFlash(el, selector) {
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
    background: '#10B981', color: 'white',
    padding: '10px 16px', fontSize: '13px', fontFamily: 'sans-serif',
    fontWeight: '600', textAlign: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  });
  flash.textContent = `Secici yakalandi: ${selector}  —  Eklentiyi tekrar acin`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 3000);
}

// ── Selector generation ────────────────────────────────────────────────────
function generateSelector(el) {
  if (el.id && /^[a-zA-Z_-]/.test(el.id)) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  if (el.name)  return `${tag}[name="${CSS.escape(el.name)}"]`;

  if (el.placeholder) {
    const s = `${tag}[placeholder="${CSS.escape(el.placeholder)}"]`;
    if (document.querySelectorAll(s).length === 1) return s;
  }

  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && attr.value) {
      const s = `${tag}[${attr.name}="${CSS.escape(attr.value)}"]`;
      if (document.querySelectorAll(s).length === 1) return s;
    }
  }

  return buildDomPath(el);
}

function buildDomPath(el) {
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (cur.id && /^[a-zA-Z_-]/.test(cur.id)) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
    const tag = cur.tagName.toLowerCase();
    const siblings = Array.from(cur.parentElement?.children || []).filter(s => s.tagName === cur.tagName);
    const idx = siblings.indexOf(cur) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

// ── Highlight (live, from popup selector input) ────────────────────────────
function highlightSelector(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = el.style.outline;
    el.style.outline = '3px solid #4F46E5';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = ''; }, 2000);
  } catch (_) {}
}

// ── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function notify(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }
function storageGet(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function previewText(d) { return Object.values(d).slice(0, 3).map(v => String(v)).join(' | ').slice(0, 60); }
