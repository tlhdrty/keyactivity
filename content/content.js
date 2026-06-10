'use strict';

// ── Module state ───────────────────────────────────────────────────────────
let isRunning  = false;
let isPaused   = false;
let inspectorResolve = null;
let hoveredEl  = null;
let overlayEl  = null;

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
      return true;   // async

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
      // Background tells us this tab finished loading → continue in navigation mode
      continueFromStorage()
        .then(() => respond({ success: true }))
        .catch(() => respond({ success: false }));
      return true;

    case 'START_INSPECTOR':
      startInspector()
        .then(selector => respond({ success: true, selector }))
        .catch(err    => respond({ success: false, error: err.message }));
      return true;

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
  const { rows, headers, mappings, submitSelector, finishSelector, delay, waitMode, totalRows } = config;

  for (let i = startRow; i < totalRows; i++) {
    // Check stop
    if (!isRunning) break;

    // Pause gate
    while (isPaused && isRunning) await sleep(150);
    if (!isRunning) break;

    // Build object {headerName: value}
    const rowData = {};
    headers.forEach((h, idx) => { rowData[h] = rows[i]?.[idx] ?? ''; });

    // Report progress to popup
    notify({ type: 'PROGRESS', current: i + 1, total: totalRows, preview: previewText(rowData) });
    chrome.storage.local.set({ keyactivity_currentRow: i + 1 });

    // Fill every mapped field
    const fillErrors = await fillForm(rowData, mappings);
    fillErrors.forEach(e => notify({ type: 'ERROR', error: e, fatal: false }));

    const isLast = (i === totalRows - 1);

    if (isLast && finishSelector) {
      // Last row → click Finish
      await clickElement(finishSelector, '"Finish" butonuna tiklanamadi');
    } else if (!isLast && submitSelector) {
      // Intermediate rows → click Add Another
      await clickElement(submitSelector, '"Add Another" butonuna tiklanamadi');
    } else if (!isLast) {
      // Fallback: press Enter
      pressEnter();
    }

    notify({ type: 'ROW_DONE', rowIndex: i });

    // Wait strategy
    if (!isLast) {
      if (waitMode === 'delay') {
        await sleep(delay);
      } else {
        // navigation mode: content script re-runs on next page via PAGE_LOADED
        // Store remaining rows in storage and exit; background will restart us
        await chrome.storage.local.set({
          keyactivity_running:    true,
          keyactivity_currentRow: i + 1,
          keyactivity_config:     config
        });
        return;   // exit — background.js will trigger PAGE_LOADED on next load
      }
    }
  }

  // Done
  if (isRunning) {
    isRunning = false;
    await chrome.storage.local.set({ keyactivity_running: false });
    notify({ type: 'DONE', total: totalRows });
  }
}

// Called by PAGE_LOADED in navigation mode
async function continueFromStorage() {
  const data = await storageGet(['keyactivity_running', 'keyactivity_config', 'keyactivity_currentRow']);
  if (!data.keyactivity_running || !data.keyactivity_config) return;

  const cfg = data.keyactivity_config;
  const from = data.keyactivity_currentRow || 0;

  if (from >= cfg.totalRows) {
    await chrome.storage.local.set({ keyactivity_running: false });
    notify({ type: 'DONE', total: cfg.totalRows });
    return;
  }

  // Small delay so page is fully interactive
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
    if (!el) {
      errors.push(`Element bulunamadi: ${selector}`);
      continue;
    }
    await fillElement(el, String(rowData[column] ?? ''));
    await sleep(60);   // small inter-field delay
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
    if (opt) {
      el.value = opt.value;
      fireEvent(el, 'change');
    }

  } else if (type === 'checkbox') {
    const checked = ['true', '1', 'yes', 'evet', 'var', 'x'].includes(value.toLowerCase());
    if (el.checked !== checked) { el.checked = checked; fireEvent(el, 'change'); fireEvent(el, 'click'); }

  } else {
    // text / number / date / email / textarea
    setNativeValue(el, value);
    fireEvent(el, 'input');
    fireEvent(el, 'change');
  }
}

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
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
    active.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', bubbles: true }));
  }
}

// ── Inspector mode ─────────────────────────────────────────────────────────
function startInspector() {
  return new Promise((resolve, reject) => {
    stopInspector();   // clean up any previous session

    inspectorResolve = resolve;

    // Full-page transparent overlay captures all clicks
    overlayEl = document.createElement('div');
    Object.assign(overlayEl.style, {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: '2147483646', cursor: 'crosshair',
      background: 'transparent'
    });
    document.body.appendChild(overlayEl);

    // Inject highlight style
    if (!document.getElementById('_ka_style')) {
      const s = document.createElement('style');
      s.id = '_ka_style';
      s.textContent = '._ka_hl { outline: 3px solid #4F46E5 !important; outline-offset: 2px !important; background-color: rgba(79,70,229,0.08) !important; }';
      document.head.appendChild(s);
    }

    // Hover to highlight underlying element
    overlayEl.addEventListener('mousemove', onMove);
    overlayEl.addEventListener('click', onClick);

    // Escape to cancel
    document.addEventListener('keydown', onEsc, true);

    function onMove(e) {
      if (hoveredEl) hoveredEl.classList.remove('_ka_hl');
      overlayEl.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      overlayEl.style.pointerEvents = '';
      if (under && under !== overlayEl) { hoveredEl = under; under.classList.add('_ka_hl'); }
    }

    function onClick(e) {
      e.preventDefault(); e.stopPropagation();
      overlayEl.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      overlayEl.style.pointerEvents = '';
      if (under && under !== overlayEl) {
        const sel = generateSelector(under);
        stopInspector();
        resolve(sel);
      }
    }

    function onEsc(e) {
      if (e.key === 'Escape') { stopInspector(); reject(new Error('Inspector iptal edildi')); }
    }

    // Store cleanup refs
    overlayEl._onMove = onMove;
    overlayEl._onClick = onClick;
    overlayEl._onEsc = onEsc;
  });
}

function stopInspector() {
  if (hoveredEl) { hoveredEl.classList.remove('_ka_hl'); hoveredEl = null; }
  if (overlayEl) {
    overlayEl.removeEventListener('mousemove', overlayEl._onMove);
    overlayEl.removeEventListener('click',     overlayEl._onClick);
    document.removeEventListener('keydown',    overlayEl._onEsc, true);
    overlayEl.remove();
    overlayEl = null;
  }
  inspectorResolve = null;
}

// ── Selector generation ────────────────────────────────────────────────────
function generateSelector(el) {
  // id
  if (el.id && /^[a-zA-Z_-]/.test(el.id)) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();

  // name attribute (most reliable for form inputs)
  if (el.name) return `${tag}[name="${CSS.escape(el.name)}"]`;

  // placeholder
  if (el.placeholder) {
    const sel = `${tag}[placeholder="${CSS.escape(el.placeholder)}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // data-* attributes
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && attr.value) {
      const sel = `${tag}[${attr.name}="${CSS.escape(attr.value)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }

  // type attribute for inputs
  if (el.type && tag === 'input') {
    const sel = `input[type="${el.type}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // Fallback: DOM path
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

// ── Highlight (from popup's selector input) ────────────────────────────────
function highlightSelector(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '3px solid #4F46E5';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
  } catch (_) {}
}

// ── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function notify(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function previewText(rowData) {
  return Object.values(rowData).slice(0, 3).map(v => String(v)).join(' | ').slice(0, 60);
}

// ── Auto-continue on page load (navigation mode) ───────────────────────────
(async () => {
  const data = await storageGet(['keyactivity_running', 'keyactivity_waitMode']);
  if (data.keyactivity_running && data.keyactivity_waitMode === 'navigation') {
    // background.js will send PAGE_LOADED shortly; this path is a safety net
  }
})();
