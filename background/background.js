'use strict';

// ── Navigation mode coordinator ────────────────────────────────────────────
// When the user's form navigates to a new page after submit,
// background.js detects the tab load and tells content.js to continue.

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  chrome.storage.local.get(
    ['keyactivity_running', 'keyactivity_targetTab', 'keyactivity_config'],
    data => {
      if (!data.keyactivity_running) return;
      if (tabId !== data.keyactivity_targetTab) return;
      if (data.keyactivity_config?.waitMode !== 'navigation') return;

      // Small delay to let the page settle before content.js tries to fill
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'PAGE_LOADED' }).catch(() => {});
      }, 500);
    }
  );
});

// ── Extension icon badge ───────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.keyactivity_running) {
    const running = changes.keyactivity_running.newValue;
    chrome.action.setBadgeText({ text: running ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ color: running ? '#10B981' : '#6B7280' });
  }
});
