// AVQR Background Service Worker - Matany Group x FUE

chrome.runtime.onInstalled.addListener(() => {
  console.log('⚡ AVQR - ATT Vision QR Tool Extension Installed');
  chrome.storage.local.set({
    avqr_session_id: 'AVQR-DEMO01',
    avqr_remaining_seconds: 180
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
  }
  return true;
});
