// AVQR Presenter Engine - 3-Minute AutoSave & Full-Page Dynamic QR
// Designed by Matany Group for Future University in Egypt (FUE)

const SERVER_URL = (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('chrome-extension://'))
  ? window.location.origin
  : 'https://e7dar.com';
const LOCAL_FALLBACK_URL = 'http://localhost:3001';

// Web Browser Environment Shim for standalone testing without extension installation
if (typeof chrome === 'undefined' || !chrome.storage) {
  window.chrome = window.chrome || {};
  chrome.storage = {
    local: {
      get: (keys, cb) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => {
            try {
              const val = localStorage.getItem(k);
              res[k] = val !== null ? JSON.parse(val) : undefined;
            } catch (e) {
              res[k] = localStorage.getItem(k);
            }
          });
        }
        if (typeof cb === 'function') cb(res);
      },
      set: (items, cb) => {
        if (items && typeof items === 'object') {
          Object.entries(items).forEach(([k, v]) => {
            localStorage.setItem(k, JSON.stringify(v));
          });
        }
        if (typeof cb === 'function') cb();
      },
      remove: (keys, cb) => {
        if (Array.isArray(keys)) {
          keys.forEach(k => localStorage.removeItem(k));
        }
        if (typeof cb === 'function') cb();
      }
    }
  };
  chrome.tabs = {
    query: (queryInfo, cb) => {
      if (typeof cb === 'function') cb([]);
    },
    create: (props) => {
      if (props && props.url) window.open(props.url, '_blank');
    },
    sendMessage: () => Promise.resolve()
  };
  chrome.runtime = {
    getURL: (path) => path
  };
}

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('sid') || urlParams.get('sessionId') || 'AVQR-2026';

let activeServerUrl = SERVER_URL;
let rotationSeconds = 5;
const ROTATION_TOTAL = 5;
let rotationInterval = null;

let autoSaveSeconds = 180; // 3 Minutes countdown
let autoSaveInterval = null;
let sseSource = null;
let pollRecordsInterval = null;
let currentAttendeeCount = 0;

function updateAttendeeCounter(count) {
  currentAttendeeCount = count;
  const countEl = document.getElementById('qrAttendeeCount');
  if (countEl) {
    countEl.textContent = String(count);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const sessionTag = document.getElementById('sessionTag');
  if (sessionTag) sessionTag.textContent = sessionId;

  // Resolve active server
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) throw new Error();
  } catch (e) {
    try {
      const resLocal = await fetch(`${LOCAL_FALLBACK_URL}/health`);
      if (resLocal.ok) activeServerUrl = LOCAL_FALLBACK_URL;
    } catch (e2) {}
  }

  // Initial attendee count from Neon DB
  try {
    fetch(`${activeServerUrl}/api/session/${sessionId}/records`)
      .then(r => r.json())
      .then(records => {
        if (Array.isArray(records)) updateAttendeeCounter(records.length);
      })
      .catch(() => {});
  } catch (e) {}

  // Check synced start time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['avqr_start_time'], (res) => {
      if (res.avqr_start_time) {
        const elapsed = Math.floor((Date.now() - res.avqr_start_time) / 1000);
        autoSaveSeconds = Math.max(0, 180 - elapsed);
        updateTimerDisplay();
      }
    });
  }

  // Initial fetch and render
  await fetchDynamicQrAndCode();

  // Start 5-second dynamic rotation in background
  rotationInterval = setInterval(() => {
    if (rotationSeconds > 1) {
      rotationSeconds--;
    } else {
      rotationSeconds = ROTATION_TOTAL;
      fetchDynamicQrAndCode();
    }
  }, 1000);

  // Start 3-minute Countdown with Auto-Close & Auto-Save
  start3MinuteCountdown();

  // Connect Real-Time Dual Listener to Broadcast Attendance to Portal Tabs
  startPresenterSync();

  // Close Button Action
  const btnClose = document.getElementById('btnPresenterCloseOnly');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      window.close();
    });
  }
});

async function fetchDynamicQrAndCode() {
  try {
    const res = await fetch(`${activeServerUrl}/api/session/${sessionId}/dynamic-token`);
    if (res.ok) {
      const data = await res.json();
      const qrPayload = data.dynamicQr;
      renderLargeQr(qrPayload.qrString);
      renderNumericCode(qrPayload.numericCode);
    } else {
      fallbackRender();
    }
  } catch (e) {
    fallbackRender();
  }
}

function renderLargeQr(text) {
  const canvas = document.getElementById('presenterQrCanvas');
  if (!canvas) return;

  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
    window.QRCode.toCanvas(canvas, text, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#121212',
        light: '#FFFFFF'
      }
    }, (err) => {
      if (err) console.error('QR draw error:', err);
    });
  } else {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 320, 320);
    ctx.fillStyle = '#121212';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('QR Live Ready', 80, 160);
  }
}

function renderNumericCode(code) {
  const el = document.getElementById('numericCodeDisplay');
  if (!el) return;
  if (!code) {
    el.textContent = '--------';
    return;
  }
  const formatted = code.length === 8 ? `${code.slice(0, 4)} - ${code.slice(4)}` : code;
  el.textContent = formatted;
}

function fallbackRender() {
  const mockCode = (Math.floor(Date.now() / 5000) % 90000000 + 10000000).toString();
  const mockQr = `${activeServerUrl}/attend?s=${encodeURIComponent(sessionId)}&c=${mockCode}`;
  renderLargeQr(mockQr);
  renderNumericCode(mockCode);
}

// -------------------------------------------------------------
// Real-Time SSE + Polling in Presenter Window -> Broadcasts to Tabs
// -------------------------------------------------------------
function startPresenterSync() {
  try {
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
    }

    sseSource = new EventSource(`${activeServerUrl}/api/session/${sessionId}/stream`);

    sseSource.addEventListener('STUDENT_ATTENDED', (e) => {
      try {
        const student = JSON.parse(e.data);
        updateAttendeeCounter(currentAttendeeCount + 1);
        broadcastStudentToTabs(student);
      } catch (err) {}
    });

    sseSource.addEventListener('AUTO_SAVED', () => {
      triggerAutoSaveAndClose();
    });
  } catch (err) {}

  // Resilient Polling
  clearInterval(pollRecordsInterval);
  pollRecordsInterval = setInterval(() => {
    fetch(`${activeServerUrl}/api/session/${sessionId}/records`)
      .then(r => r.json())
      .then(records => {
        if (Array.isArray(records)) {
          updateAttendeeCounter(records.length);
          records.forEach(rec => {
            broadcastStudentToTabs({
              studentId: rec.student_id,
              fullName: rec.student_name
            });
          });
        }
      })
      .catch(() => {});
  }, 2000);
}

function broadcastStudentToTabs(student) {
  if (!student) return;
  const sId = student.studentId || student.student_id;
  const sName = student.fullName || student.student_name;

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'RECORD_ATTENDEE',
            studentId: sId,
            fullName: sName
          }).catch(() => {});
        }
      }
    });
  }
}

// 3-Minute Countdown: Closes presenter and auto-saves when expired
function start3MinuteCountdown() {
  updateTimerDisplay();

  autoSaveInterval = setInterval(async () => {
    if (autoSaveSeconds > 0) {
      autoSaveSeconds--;
      updateTimerDisplay();
    } else {
      clearInterval(autoSaveInterval);
      clearInterval(rotationInterval);
      await triggerAutoSaveAndClose();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('timerDisplay');
  if (!el) return;
  const m = Math.floor(autoSaveSeconds / 60);
  const s = autoSaveSeconds % 60;
  el.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function triggerAutoSaveAndClose() {
  try {
    // 1. Inform server to mark session auto-saved
    await fetch(`${activeServerUrl}/api/session/${sessionId}/auto-save`, { method: 'POST' });

    // 2. Notify portal tabs to submit and lock attendance
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTO_SAVE' }).catch(() => {});
        }
      }
    }

    // 3. Mark session inactive in storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ avqr_is_active: false });
      chrome.storage.local.remove(['avqr_start_time']);
    }
  } catch (err) {
    console.error('Auto save error:', err);
  } finally {
    // 4. Close the presenter window cleanly
    setTimeout(() => {
      window.close();
    }, 600);
  }
}
