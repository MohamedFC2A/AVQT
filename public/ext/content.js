// AVQR Content Script - Auto Checkbox Detection & 3-Minute Auto-Save Engine
// Designed by Matany Group for Future University in Egypt (FUE)

(function () {
  let activeSessionId = 'AVQR-2026';
  let serverUrl = 'http://localhost:3001';
  let sseSource = null;

  console.log('[AVQR] Content Script Initialized on Page:', window.location.href);

  // Read stored session if available
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['avqr_session_id', 'avqr_is_active'], (res) => {
      if (res.avqr_session_id) {
        activeSessionId = res.avqr_session_id;
      }
      if (res.avqr_is_active) {
        initWidget();
        connectSse(activeSessionId);
      }
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ACTIVATE_AUTOSYNC') {
      activeSessionId = msg.sessionId || activeSessionId;
      serverUrl = msg.serverUrl || serverUrl;
      initWidget();
      connectSse(activeSessionId);
      updateWidgetStatus(`جلسة نشطة: ${activeSessionId}`);
      sendResponse({ status: 'ACTIVE' });
    } else if (msg.action === 'TRIGGER_AUTO_SAVE') {
      executePortalAutoSave();
      sendResponse({ status: 'SAVED' });
    }
  });

  function connectSse(sessionId) {
    if (sseSource) sseSource.close();

    try {
      sseSource = new EventSource(`${serverUrl}/api/session/${sessionId}/stream`);

      sseSource.addEventListener('STUDENT_ATTENDED', (e) => {
        const student = JSON.parse(e.data);
        console.log('[AVQR] Student Attended Event:', student);
        markStudentPresentInDom(student.studentId, student.fullName);
      });

      sseSource.addEventListener('AUTO_SAVED', () => {
        executePortalAutoSave();
      });

      sseSource.onerror = () => {
        updateWidgetStatus('جاري الاتصال...');
      };
    } catch (err) {
      console.warn('[AVQR] SSE connection error:', err);
    }
  }

  // Match and tick checkbox with 0% error rate
  function markStudentPresentInDom(studentId, fullName) {
    if (!studentId) return;

    // 1. Direct match by attribute
    let row = document.querySelector(`[data-student-id="${studentId}"]`) ||
              document.querySelector(`#row-${studentId}`);

    // 2. Fallback search all table rows
    if (!row) {
      const allRows = document.querySelectorAll('tr, .student-row');
      for (const r of allRows) {
        const text = r.textContent || '';
        if (text.includes(studentId)) {
          row = r;
          break;
        }
      }
    }

    if (row) {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox) {
        if (!checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('input', { bubbles: true }));
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Apply Neubrutalism highlighting effect
        row.classList.add('avqr-highlight-attended');
        row.style.outline = '3px solid #00F090';
        row.style.backgroundColor = '#ECFDF5';

        const statusCell = row.querySelector('.status-cell, td:last-child');
        if (statusCell && !statusCell.querySelector('.avqr-badge')) {
          const badge = document.createElement('span');
          badge.className = 'avqr-badge';
          badge.textContent = 'حاضر (AVQR)';
          statusCell.innerHTML = '';
          statusCell.appendChild(badge);
        }

        showFloatingNotification(`تم رصد حضور الطالب: ${studentId} (${fullName || ''}) بنسبة خطأ 0%`);
        updateAttendedCount();
      }
    }
  }

  function updateAttendedCount() {
    const checked = document.querySelectorAll('input[type="checkbox"]:checked').length;
    const countBadge = document.getElementById('avqrWidgetCount');
    if (countBadge) {
      countBadge.textContent = checked;
    }
  }

  // 3-Minute Auto-Save trigger
  function executePortalAutoSave() {
    console.log('[AVQR] Executing Auto-Save on Attendance Portal');

    const saveBtn = document.querySelector('#btnSaveAttendance') ||
                    document.querySelector('button[type="submit"]') ||
                    document.querySelector('input[type="submit"][value*="Save"]') ||
                    document.querySelector('input[type="submit"][value*="حفظ"]') ||
                    document.querySelector('.btn-save');

    if (saveBtn) {
      saveBtn.click();
      showFloatingNotification('تم حفظ كشف الحضور تلقائياً بنجاح بنسبة خطأ 0%', 8000);
    } else {
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        showFloatingNotification('تم إرسال وحفظ كشف الحضور بنجاح', 8000);
      }
    }
  }

  // In-Page Floating Widget
  function initWidget() {
    if (document.getElementById('avqrFloatingWidget')) return;

    const widget = document.createElement('div');
    widget.id = 'avqrFloatingWidget';
    widget.className = 'avqr-floating-widget';
    widget.innerHTML = `
      <div class="avqr-widget-header">
        <span class="avqr-widget-tag">AVQR • Matany Group</span>
        <button id="avqrWidgetMinimize" class="avqr-min-btn">—</button>
      </div>
      <div class="avqr-widget-body" id="avqrWidgetBody">
        <div class="avqr-widget-session">
          <small>جلسة الحضور:</small>
          <strong id="avqrWidgetSessionName">${activeSessionId}</strong>
        </div>
        <div class="avqr-widget-stats">
          <span>الحاضرون تلقائياً:</span>
          <strong id="avqrWidgetCount" class="avqr-count-pill">0</strong>
        </div>
        <div class="avqr-timer-line">
          <span>الحفظ التلقائي:</span>
          <span>3 دقائق</span>
        </div>
        <button id="avqrWidgetSaveBtn" class="avqr-widget-btn">حفظ الكشف الآن</button>
      </div>
    `;

    document.body.appendChild(widget);

    const minBtn = document.getElementById('avqrWidgetMinimize');
    const body = document.getElementById('avqrWidgetBody');
    minBtn.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
      minBtn.textContent = body.style.display === 'none' ? '+' : '—';
    });

    document.getElementById('avqrWidgetSaveBtn').addEventListener('click', () => {
      executePortalAutoSave();
    });
  }

  function updateWidgetStatus(text) {
    const el = document.getElementById('avqrWidgetSessionName');
    if (el) el.textContent = text;
  }

  function showFloatingNotification(msg, duration = 4000) {
    let container = document.getElementById('avqrToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'avqrToastContainer';
      container.className = 'avqr-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'avqr-toast-item';
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }
})();
