// AVQR Background Service Worker - Matany Group x FUE

chrome.runtime.onInstalled.addListener(() => {
  console.log('⚡ AVQR - ATT Vision QR Tool Extension Installed');
  chrome.storage.local.set({
    avqr_session_id: 'AVQR-2026',
    avqr_is_active: false
  });
  chrome.storage.local.remove(['avqr_start_time', 'avqr_remaining_seconds']);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_PRESENTER') {
    const sid = message.sessionId || 'AVQR-2026';
    const url = chrome.runtime.getURL(`presenter.html?sid=${encodeURIComponent(sid)}`);
    chrome.tabs.create({ url }, (newTab) => {
      sendResponse({ status: 'OPENED', tabId: newTab ? newTab.id : null });
    });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
  }
  return true;
});
