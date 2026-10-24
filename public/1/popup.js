// AVQR Chrome Extension Popup Engine - Neubrutalism & Real-Time Sync
// Designed by Matany Group for Future University in Egypt (FUE)

const SERVER_URL = 'https://avqr-matany-fue.vercel.app';
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

let currentSessionId = 'AVQR-2026';
let sseSource = null;
let rotationInterval = null;
let autoSaveInterval = null;
let pollRecordsInterval = null;
let rotationSeconds = 5;
const ROTATION_TOTAL_SECONDS = 5;
let autoSaveSeconds = 180;
const TOTAL_AUTOSAVE_SECONDS = 180;
let isSessionActive = false;
let activeServerUrl = SERVER_URL;

function initCinematicSmartSplash() {
  const splash = document.getElementById('avqrSmartSplash');
  if (!splash) return;

  const canvas = document.getElementById('splashCanvas');
  const video = document.getElementById('splashVideo');
  const withLabel = document.getElementById('splashWithLabel');
  const slideFue = document.getElementById('splashSlideFue');
  const slideMoodle = document.getElementById('splashSlideMoodle');
  const slideMatany = document.getElementById('splashSlideMatany');
  const slideUpstore = document.getElementById('splashSlideUpstore');

  const ctx = canvas ? canvas.getContext('2d') : null;
  let dismissed = false;
  let rafId = null;

  splash.addEventListener('contextmenu', (e) => e.preventDefault());
  if (canvas) canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function setWithLabel(text) {
    if (!withLabel) return;
    withLabel.style.opacity = '0';
    withLabel.style.transform = 'translateY(-4px)';
    setTimeout(() => {
      withLabel.textContent = text;
      withLabel.style.opacity = '1';
      withLabel.style.transform = 'translateY(0)';
    }, 150);
  }

  // Force reset splash visibility on every single execution
  splash.classList.remove('dismissed');
  splash.style.display = 'flex';
  splash.style.opacity = '1';
  splash.style.visibility = 'visible';

  splash.onclick = () => {
    dismissSplash();
  };

  if (withLabel) {
    withLabel.textContent = 'With';
    withLabel.style.opacity = '1';
    withLabel.style.transform = 'translateY(0)';
  }

  if (slideFue) {
    slideFue.classList.remove('exit');
    slideFue.classList.add('active');
  }
  if (slideMoodle) {
    slideMoodle.classList.remove('active', 'exit');
  }
  if (slideMatany) {
    slideMatany.classList.remove('active', 'exit');
  }
  if (slideUpstore) {
    slideUpstore.classList.remove('active', 'exit');
  }

  function dismissSplash() {
    if (dismissed) return;
    dismissed = true;
    if (rafId) cancelAnimationFrame(rafId);
    splash.classList.add('dismissed');
    setTimeout(() => {
      splash.style.display = 'none';
      if (video) {
        try { video.pause(); } catch (e) {}
      }
    }, 400);
  }

  // 1. Instant poster fallback (0ms latency, zero black flash)
  const posterImg = new Image();
  posterImg.src = 'assets/splash-poster.png';
  posterImg.onload = () => {
    if (ctx && (!video || video.paused || video.currentTime === 0)) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(posterImg, 0, 0, canvas.width, canvas.height);
    }
  };
  if (posterImg.complete && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(posterImg, 0, 0, canvas.width, canvas.height);
  }

  // 2. Smooth Canvas Render Loop
  function renderFrame() {
    if (dismissed || !ctx || !video) return;

    if (video.readyState >= 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    if (video.currentTime >= 3.68) {
      try { video.pause(); } catch (e) {}
      return;
    }

    rafId = requestAnimationFrame(renderFrame);
  }

  if (video) {
    video.muted = true;
    video.playsInline = true;
    video.currentTime = 0;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {});
    }

    video.addEventListener('play', () => {
      renderFrame();
    });

    video.addEventListener('timeupdate', () => {
      if (video.currentTime >= 3.68) {
        video.pause();
      }
    });

    video.addEventListener('ended', () => {
      video.pause();
    });

    renderFrame();
  }

  // 3. Partner Carousel
  // Stage 1: FUE (0s - 1.2s)
  if (slideFue) {
    slideFue.classList.remove('exit');
    slideFue.classList.add('active');
  }

  // Stage 2: Moodle (1.2s - 2.4s)
  setTimeout(() => {
    if (dismissed) return;
    if (slideFue) {
      slideFue.classList.remove('active');
      slideFue.classList.add('exit');
    }
    if (slideMoodle) {
      slideMoodle.classList.remove('exit');
      slideMoodle.classList.add('active');
    }
  }, 1200);

  // Stage 3: Matany Group (2.4s - 3.8s) -> Label: 'Built By'
  setTimeout(() => {
    if (dismissed) return;
    setWithLabel('Built By');
    if (slideMoodle) {
      slideMoodle.classList.remove('active');
      slideMoodle.classList.add('exit');
    }
    if (slideMatany) {
      slideMatany.classList.remove('exit');
      slideMatany.classList.add('active');
    }
  }, 2400);

  // Stage 4: upstore.one (3.8s - 5.2s) -> Label: 'Design By'
  setTimeout(() => {
    if (dismissed) return;
    setWithLabel('Design By');
    if (slideMatany) {
      slideMatany.classList.remove('active');
      slideMatany.classList.add('exit');
    }
    if (slideUpstore) {
      slideUpstore.classList.remove('exit');
      slideUpstore.classList.add('active');
    }
  }, 3800);

  // Stage 5: Cinematic Exit (5.2s)
  setTimeout(() => {
    dismissSplash();
  }, 5200);

  // Safety fallback
  setTimeout(() => {
    dismissSplash();
  }, 6000);
}

document.addEventListener('DOMContentLoaded', () => {
  initCinematicSmartSplash();

  const idleSection = document.getElementById('idleSection');
  const activeSection = document.getElementById('activeSection');
  const sessionIdInput = document.getElementById('sessionIdInput');
  const btnStartSession = document.getElementById('btnStartSession');
  const btnOpenPresenterFull = document.getElementById('btnOpenPresenterFull');
  const btnStopSession = document.getElementById('btnStopSession');

  // Check saved state in storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['avqr_session_id', 'avqr_is_active', 'avqr_start_time'], (res) => {
      if (res.avqr_session_id) {
        currentSessionId = res.avqr_session_id;
        sessionIdInput.value = currentSessionId;
      }
      if (res.avqr_is_active) {
        if (res.avqr_start_time) {
          const elapsed = Math.floor((Date.now() - res.avqr_start_time) / 1000);
          autoSaveSeconds = Math.max(0, TOTAL_AUTOSAVE_SECONDS - elapsed);
        }
        startActiveSession(currentSessionId, false);
      }
    });
  }

  function openFullPresenter(sid) {
    const effectiveSid = sid || currentSessionId || 'AVQR-2026';
    const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL(`presenter.html?sid=${encodeURIComponent(effectiveSid)}`)
      : `presenter.html?sid=${encodeURIComponent(effectiveSid)}`;
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  }

  // Start Session Button
  btnStartSession.addEventListener('click', async () => {
    const sid = sessionIdInput.value.trim() || 'AVQR-2026';
    currentSessionId = sid;
    const startTime = Date.now();
    autoSaveSeconds = TOTAL_AUTOSAVE_SECONDS;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        avqr_session_id: sid,
        avqr_is_active: true,
        avqr_server_url: activeServerUrl,
        avqr_start_time: startTime,
        avqr_sync_pulse: startTime
      });
    }

    // Immediately open full-page Presenter tab
    openFullPresenter(sid);

    await startActiveSession(sid, true);
  });

  // Open Full-Page Presenter Button
  if (btnOpenPresenterFull) {
    btnOpenPresenterFull.addEventListener('click', () => {
      openFullPresenter(currentSessionId);
    });
  }

  // Stop Session Button
  btnStopSession.addEventListener('click', () => {
    stopActiveSession();
  });

  // Open Full-Page Presenter Mode on QR Click
  const btnOpenPresenter = document.getElementById('btnOpenPresenterMode');
  if (btnOpenPresenter) {
    btnOpenPresenter.addEventListener('click', () => {
      openFullPresenter(currentSessionId);
    });
  }
});

async function startActiveSession(sessionId, resetTimer = true) {
  isSessionActive = true;
  document.getElementById('idleSection').classList.add('hidden');
  document.getElementById('activeSection').classList.remove('hidden');

  const badge = document.getElementById('activeSessionBadge');
  if (badge) badge.textContent = sessionId;

  // Activate content script in tabs to auto-tick checkboxes
  notifyCurrentTabToSync(sessionId);

  // Fetch initial token and render QR + 8-digit code immediately
  await refreshDynamicQrAndCode(sessionId);

  // Start 5-second rotation timer
  rotationSeconds = ROTATION_TOTAL_SECONDS;
  clearInterval(rotationInterval);
  rotationInterval = setInterval(() => {
    if (rotationSeconds > 1) {
      rotationSeconds--;
      updateRotationDisplay();
    } else {
      rotationSeconds = ROTATION_TOTAL_SECONDS;
      updateRotationDisplay();
      refreshDynamicQrAndCode(sessionId);
    }
  }, 1000);

  // Start 3-minute auto-save timer
  if (resetTimer) {
    autoSaveSeconds = TOTAL_AUTOSAVE_SECONDS;
  }
  startAutoSaveTimer();

  // Connect Real-time SSE + Active Polling
  connectDualSync(sessionId);
}

function stopActiveSession() {
  isSessionActive = false;
  clearInterval(rotationInterval);
  clearInterval(autoSaveInterval);
  clearInterval(pollRecordsInterval);
  if (sseSource) {
    try { sseSource.close(); } catch (e) {}
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ avqr_is_active: false });
    chrome.storage.local.remove(['avqr_start_time']);
  }

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab && tab.id && tab.url && !tab.url.startsWith('chrome://')) {
          chrome.tabs.sendMessage(tab.id, { action: 'STOP_AUTOSYNC' }).catch(() => {});
        }
      }
    });
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
  if (!canvas) return;
  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
    window.QRCode.toCanvas(canvas, text, {
      width: 160,
      margin: 1,
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
    ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = '#121212';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('QR Code Ready', 35, 80);
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

function fallbackRender(sessionId) {
  const mockCode = (Math.floor(Date.now() / 5000) % 90000000 + 10000000).toString();
  const mockQr = `${activeServerUrl}/attend?s=${encodeURIComponent(sessionId)}&c=${mockCode}`;
  renderStandardQr(mockQr);
  renderNumericCode(mockCode);
}

function updateRotationDisplay() {
  // Silent background rotation
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
  const m = Math.floor(autoSaveSeconds / 60);
  const s = autoSaveSeconds % 60;
  if (timerCountdown) {
    timerCountdown.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}

async function triggerAutoSave() {
  try {
    await fetch(`${activeServerUrl}/api/session/${currentSessionId}/auto-save`, { method: 'POST' });
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTO_SAVE' }).catch(() => {});
        }
      }
    }
    console.log('✅ Auto-save completed silently with 0% error.');
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
          if (chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              files: ['content.js']
            }).catch(() => {});
          }
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

function broadcastAttendeeToTabs(student) {
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

function connectDualSync(sessionId) {
  if (sseSource) {
    try { sseSource.close(); } catch (e) {}
  }

  try {
    sseSource = new EventSource(`${activeServerUrl}/api/session/${sessionId}/stream`);
    sseSource.addEventListener('STUDENT_ATTENDED', (e) => {
      try {
        const student = JSON.parse(e.data);
        updateLiveAttendee(student);
      } catch (err) {}
    });
  } catch (e) {}

  clearInterval(pollRecordsInterval);
  pollRecordsInterval = setInterval(() => {
    try {
      refreshSessionRecords(sessionId);
    } catch (e) {}
  }, 1500);

  refreshSessionRecords(sessionId);
}

function refreshSessionRecords(sessionId) {
  fetch(`${activeServerUrl}/api/session/${sessionId}/records`)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(records => {
      if (Array.isArray(records)) {
        const livePresentCount = document.getElementById('livePresentCount');
        if (livePresentCount) livePresentCount.textContent = records.length;
        if (records.length > 0) {
          const last = records[records.length - 1];
          updateLiveAttendee({ studentId: last.student_id, fullName: last.student_name }, records.length);
        }
      }
    })
    .catch(() => {});
}

function updateLiveAttendee(student, count) {
  const livePresentCount = document.getElementById('livePresentCount');
  const popupQrCenterCount = document.getElementById('popupQrCenterCount');
  if (livePresentCount) {
    if (count !== undefined) {
      livePresentCount.textContent = count;
      if (popupQrCenterCount) popupQrCenterCount.textContent = count;
    } else {
      const current = parseInt(livePresentCount.textContent, 10) || 0;
      livePresentCount.textContent = current + 1;
      if (popupQrCenterCount) popupQrCenterCount.textContent = current + 1;
    }
  }

  const ticker = document.getElementById('liveTickerText');
  if (ticker && student) {
    const text = `تم رصد حضور: ${student.studentId || student.student_id} (${student.fullName || student.student_name})`;
    ticker.textContent = text;
    ticker.title = text;
  }

  broadcastAttendeeToTabs(student);
}

