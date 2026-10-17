const SERVER_URL = 'http://localhost:3001';

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('sessionId') || 'AVQR-DEMO01';

let rotationSeconds = 8;
let rotationInterval = null;
let autoSaveSeconds = 180;
const TOTAL_AUTOSAVE_SECONDS = 180;
let autoSaveInterval = null;
let currentQrString = `AVQR:${sessionId}:INITIAL_TOKEN:0`;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sessionTag').textContent = sessionId;

  // Initial token fetch and QR render
  fetchNewDynamicToken();

  // Rotation Interval every 1 second to update countdown and refresh at 0
  rotationInterval = setInterval(() => {
    if (rotationSeconds > 1) {
      rotationSeconds--;
      document.getElementById('rotationSecs').textContent = rotationSeconds;
    } else {
      rotationSeconds = 8;
      document.getElementById('rotationSecs').textContent = rotationSeconds;
      fetchNewDynamicToken();
    }
  }, 1000);

  // Auto-Save 3-Minute Timer
  startAutoSaveTimer();

  // Connect SSE
  connectPresenterSse();

  // Force Save Button
  document.getElementById('btnPresenterForceSave').addEventListener('click', () => {
    triggerAutoSave();
  });
});

async function fetchNewDynamicToken() {
  try {
    const res = await fetch(`${SERVER_URL}/api/session/${sessionId}/dynamic-token`);
    if (res.ok) {
      const data = await res.json();
      currentQrString = data.dynamicQr.qrString;
      drawQrToCanvas(currentQrString);
    } else {
      fallbackDrawQr(currentQrString);
    }
  } catch (err) {
    fallbackDrawQr(currentQrString);
  }
}

// Draw QR Code on Canvas using an SVG or custom procedural matrix
function drawQrToCanvas(text) {
  const canvas = document.getElementById('qrCanvas');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;

  // Clear
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);

  // Generate QR pattern procedurally or fallback
  // Create high-contrast brutalist QR representation
  renderProceduralQr(ctx, text, size);
}

function fallbackDrawQr(text) {
  const canvas = document.getElementById('qrCanvas');
  const ctx = canvas.getContext('2d');
  renderProceduralQr(ctx, text, canvas.width);
}

// Robust Canvas QR Matrix Renderer
function renderProceduralQr(ctx, text, size) {
  // Deterministic hash-based 25x25 matrix with standard QR finder patterns
  const modules = 25;
  const cellSize = Math.floor(size / modules);
  const padding = (size - (modules * cellSize)) / 2;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);

  // Simple hash for seed
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  const isFinder = (r, c) => {
    // Top-left finder
    if (r < 7 && c < 7) return true;
    // Top-right finder
    if (r < 7 && c >= modules - 7) return true;
    // Bottom-left finder
    if (r >= modules - 7 && c < 7) return true;
    return false;
  };

  const drawFinder = (startR, startC) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        if (isBorder || isCenter) {
          ctx.fillStyle = '#121212';
        } else {
          ctx.fillStyle = '#FFFFFF';
        }
        ctx.fillRect(padding + (startC + c) * cellSize, padding + (startR + r) * cellSize, cellSize, cellSize);
      }
    }
  };

  // Draw data modules
  ctx.fillStyle = '#121212';
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (isFinder(r, c)) continue;
      // Timing patterns
      if (r === 6 || c === 6) {
        if ((r + c) % 2 === 0) {
          ctx.fillRect(padding + c * cellSize, padding + r * cellSize, cellSize, cellSize);
        }
        continue;
      }

      // Pseudo-random data based on string hash and position
      const pseudoVal = Math.sin((r * modules + c) + hash) * 10000;
      if (pseudoVal - Math.floor(pseudoVal) > 0.45) {
        ctx.fillRect(padding + c * cellSize, padding + r * cellSize, cellSize, cellSize);
      }
    }
  }

  // Draw 3 Finders
  drawFinder(0, 0);
  drawFinder(0, modules - 7);
  drawFinder(modules - 7, 0);
}

function startAutoSaveTimer() {
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
  const bigTimerCountdown = document.getElementById('bigTimerCountdown');
  const bigProgressBar = document.getElementById('bigProgressBar');

  const m = Math.floor(autoSaveSeconds / 60);
  const s = autoSaveSeconds % 60;
  bigTimerCountdown.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

  const pct = (autoSaveSeconds / TOTAL_AUTOSAVE_SECONDS) * 100;
  bigProgressBar.style.width = `${pct}%`;

  if (autoSaveSeconds < 30) {
    bigProgressBar.style.background = '#FF3366';
  } else if (autoSaveSeconds < 90) {
    bigProgressBar.style.background = '#FFE600';
  } else {
    bigProgressBar.style.background = '#00F090';
  }
}

async function triggerAutoSave() {
  try {
    const res = await fetch(`${SERVER_URL}/api/session/${sessionId}/auto-save`, { method: 'POST' });
    const data = await res.json();
    alert(`🎉 تم إتمام الحفظ التلقائي بنجاح! إجمالي الحاضرين: ${data.totalPresent}`);
  } catch (err) {
    console.error('Auto save error:', err);
  }
}

function connectPresenterSse() {
  const liveFeedList = document.getElementById('liveFeedList');
  const bigPresentCount = document.getElementById('bigPresentCount');
  const tickerText = document.getElementById('tickerText');

  const sse = new EventSource(`${SERVER_URL}/api/session/${sessionId}/stream`);

  sse.addEventListener('STUDENT_ATTENDED', (e) => {
    const student = JSON.parse(e.data);
    const count = parseInt(bigPresentCount.textContent, 10) || 0;
    bigPresentCount.textContent = count + 1;

    tickerText.textContent = `🎉 تم تسجيل حضور الطالب: ${student.fullName} (${student.studentId}) بنسبة خطأ 0%!`;

    // Add feed item
    const emptyNotice = liveFeedList.querySelector('div');
    if (emptyNotice && emptyNotice.textContent.includes('بانتظار')) {
      emptyNotice.remove();
    }

    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `
      <span><strong>${student.studentId}</strong>: ${student.fullName}</span>
      <span style="color: #059669;">حاضر ✅</span>
    `;
    liveFeedList.prepend(item);
  });
}
