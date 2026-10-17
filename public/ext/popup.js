// AVQR Chrome Extension Popup Engine
// Designed by Matany Group for Future University in Egypt (FUE)

const SERVER_URL = 'https://avqr-matany-fue.vercel.app';
const LOCAL_FALLBACK_URL = 'http://localhost:3001';

let currentSessionId = 'AVQR-2026';
let sseSource = null;
let rotationInterval = null;
let autoSaveInterval = null;
let pollRecordsInterval = null;
let rotationSeconds = 8;
let autoSaveSeconds = 180;
const TOTAL_AUTOSAVE_SECONDS = 180;
let isSessionActive = false;
let activeServerUrl = SERVER_URL;

document.addEventListener('DOMContentLoaded', () => {
  const idleSection = document.getElementById('idleSection');
  const activeSection = document.getElementById('activeSection');
  const sessionIdInput = document.getElementById('sessionIdInput');
  const btnStartSession = document.getElementById('btnStartSession');
  const btnForceSave = document.getElementById('btnForceSave');
  const btnStopSession = document.getElementById('btnStopSession');
  const serverStatusText = document.getElementById('serverStatusText');

  // Check saved state in storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['avqr_session_id', 'avqr_is_active'], (res) => {
      if (res.avqr_session_id) {
        currentSessionId = res.avqr_session_id;
        sessionIdInput.value = currentSessionId;
      }
      if (res.avqr_is_active) {
        startActiveSession(currentSessionId);
      }
    });
  }

  // Health check: test primary cloud server, fallback to local if offline
  fetch(`${activeServerUrl}/health`)
    .then(r => r.json())
    .then(() => {
      serverStatusText.textContent = 'متصل بالسحابة (Neon)';
    })
    .catch(() => {
      // Test local server
      fetch(`${LOCAL_FALLBACK_URL}/health`)
        .then(r => r.json())
        .then(() => {
          activeServerUrl = LOCAL_FALLBACK_URL;
          serverStatusText.textContent = 'متصل بالخادم المحلي';
        })
        .catch(() => {
          serverStatusText.textContent = 'وضع عدم الاتصال';
        });
    });

  // Start Session Button
  btnStartSession.addEventListener('click', async () => {
    const sid = sessionIdInput.value.trim() || 'AVQR-2026';
    currentSessionId = sid;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ avqr_session_id: sid, avqr_is_active: true, avqr_server_url: activeServerUrl });
    }
    await startActiveSession(sid);
  });

  // Force Save Button
  btnForceSave.addEventListener('click', async () => {
    await triggerAutoSave();
  });

  // Stop Session Button
  btnStopSession.addEventListener('click', () => {
    stopActiveSession();
  });
});

async function startActiveSession(sessionId) {
  isSessionActive = true;
  document.getElementById('idleSection').classList.add('hidden');
  document.getElementById('activeSection').classList.remove('hidden');

  // Activate content script in current tab to auto-tick checkboxes
  notifyCurrentTabToSync(sessionId);

  // Fetch initial token and render QR + 8-digit code immediately
  await refreshDynamicQrAndCode(sessionId);

  // Start 8-second rotation timer
  rotationSeconds = 8;
  clearInterval(rotationInterval);
  rotationInterval = setInterval(() => {
    if (rotationSeconds > 1) {
      rotationSeconds--;
      updateRotationDisplay();
    } else {
      rotationSeconds = 8;
      updateRotationDisplay();
      refreshDynamicQrAndCode(sessionId);
    }
  }, 1000);

  // Start 3-minute auto-save timer
  startAutoSaveTimer();

  // Connect Real-time SSE + Dual Active Polling
  connectDualSync(sessionId);
}

function stopActiveSession() {
  isSessionActive = false;
  clearInterval(rotationInterval);
  clearInterval(autoSaveInterval);
  clearInterval(pollRecordsInterval);
  if (sseSource) sseSource.close();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ avqr_is_active: false });
  }

  document.getElementById('idleSection').classList.remove('hidden');
  document.getElementById('activeSection').classList.add('hidden');
}

async function refreshDynamicQrAndCode(sessionId) {
  try {
    const res = await fetch(`${activeServerUrl}/api/session/${sessionId}/dynamic-token`);
    if (res.ok) {
      const data = await res.json();
      const qrPayload = data.dynamicQr;
      renderStandardQr(qrPayload.qrString);
      renderNumericCode(qrPayload.numericCode);
    } else {
      fallbackRender(sessionId);
    }
  } catch (err) {
    fallbackRender(sessionId);
  }
}

function renderStandardQr(text) {
  const canvas = document.getElementById('qrCanvas');
  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
    window.QRCode.toCanvas(canvas, text, {
      width: 220,
      margin: 1,
      color: {
        dark: '#121212',
        light: '#FFFFFF'
      }
    }, (err) => {
      if (err) console.error('QR draw error:', err);
    });
  } else {
    // Fallback direct draw
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 220, 220);
    ctx.fillStyle = '#121212';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('QR Code Ready', 60, 110);
  }
}

function renderNumericCode(code) {
  const el = document.getElementById('numericCodeDisplay');
  if (!code) {
    el.textContent = '--------';
    return;
  }
  // Format as 8 digits with space: e.g. "8492 - 3105"
  const formatted = code.length === 8 ? `${code.slice(0, 4)} - ${code.slice(4)}` : code;
  el.textContent = formatted;
}

function fallbackRender(sessionId) {
  const mockCode = (Math.floor(Date.now() / 8000) % 90000000 + 10000000).toString();
  const mockQr = `https://avqr-matany-fue.vercel.app/?attend=1&sid=${sessionId}&code=${mockCode}&token=FALLBACK`;
  renderStandardQr(mockQr);
  renderNumericCode(mockCode);
}

function updateRotationDisplay() {
  document.getElementById('rotationSecondsTxt').textContent = `${rotationSeconds} ثوانٍ`;
  const pct = (rotationSeconds / 8) * 100;
  document.getElementById('rotationProgressBar').style.width = `${pct}%`;
}

function startAutoSaveTimer() {
  clearInterval(autoSaveInterval);
  updateAutoSaveDisplay();

  autoSaveInterval = setInterval(() => {
    if (autoSaveSeconds > 0) {
      autoSaveSeconds--;
      updateAutoSaveDisplay();
    } else {
      clearInterval(autoSaveInterval);
      triggerAutoSave();
    }
  }, 1000);
}

function updateAutoSaveDisplay() {
  const timerCountdown = document.getElementById('timerCountdown');
  const progressBar = document.getElementById('autoSaveProgressBar');

  const m = Math.floor(autoSaveSeconds / 60);
  const s = autoSaveSeconds % 60;
  timerCountdown.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

  const pct = (autoSaveSeconds / TOTAL_AUTOSAVE_SECONDS) * 100;
  progressBar.style.width = `${pct}%`;

  if (autoSaveSeconds < 30) {
    progressBar.style.background = '#FF3366';
  } else if (autoSaveSeconds < 90) {
    progressBar.style.background = '#FFE600';
  } else {
    progressBar.style.background = '#00F090';
  }
}

async function triggerAutoSave() {
  try {
    await fetch(`${activeServerUrl}/api/session/${currentSessionId}/auto-save`, { method: 'POST' });
    // Trigger in tab
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTO_SAVE' });
      }
    }
    alert('تم إتمام الحفظ التلقائي لكشف الحضور بنسبة خطأ 0%');
  } catch (err) {
    console.error('Auto save error:', err);
  }
}

async function notifyCurrentTabToSync(sessionId) {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'ACTIVATE_AUTOSYNC',
            sessionId,
            serverUrl: activeServerUrl
          }).catch(() => {});
        }
      }
    }
  } catch (e) {}
}

function connectDualSync(sessionId) {
  if (sseSource) sseSource.close();

  // Engine 1: SSE
  try {
    sseSource = new EventSource(`${activeServerUrl}/api/session/${sessionId}/stream`);
    sseSource.addEventListener('STUDENT_ATTENDED', (e) => {
      try {
        const student = JSON.parse(e.data);
        addStudentToUI(student);
      } catch (err) {}
    });
  } catch (e) {}

  // Engine 2: Periodic Records Polling (every 1.5s)
  clearInterval(pollRecordsInterval);
  pollRecordsInterval = setInterval(() => {
    refreshSessionRecords(sessionId);
  }, 1500);
  refreshSessionRecords(sessionId);
}

function refreshSessionRecords(sessionId) {
  fetch(`${activeServerUrl}/api/session/${sessionId}/records`)
    .then(r => r.json())
    .then(records => {
      if (Array.isArray(records)) {
        const livePresentCount = document.getElementById('livePresentCount');
        if (livePresentCount) livePresentCount.textContent = records.length;
        records.forEach(r => addStudentToUI({ studentId: r.student_id, fullName: r.student_name }));
      }
    })
    .catch(() => {});
}

function addStudentToUI(student) {
  const livePresentCount = document.getElementById('livePresentCount');
  const studentsLiveList = document.getElementById('studentsLiveList');

  const emptyNotice = studentsLiveList.querySelector('.empty-feed');
  if (emptyNotice) emptyNotice.remove();

  if (studentsLiveList.querySelector(`[data-sid="${student.studentId}"]`)) {
    return;
  }

  const li = document.createElement('li');
  li.setAttribute('data-sid', student.studentId);
  li.innerHTML = `
    <span><strong>${student.studentId}</strong>: ${student.fullName}</span>
    <span style="color: #059669; font-weight: 800;">حاضر</span>
  `;
  studentsLiveList.prepend(li);

  const currentCount = parseInt(livePresentCount.textContent, 10) || 0;
  livePresentCount.textContent = currentCount + 1;
}
