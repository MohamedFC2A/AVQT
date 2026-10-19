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
  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
  }
  return true;
});
