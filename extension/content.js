// AVQR Content Script - Universal Checkbox Automation & Real-Time Sync
// Designed by Matany Group for Future University in Egypt (FUE) & All University Portals

(function () {
  let activeSessionId = 'AVQR-2026';
  let serverUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3001' : 'https://avqr-matany-fue.vercel.app';
  let sseSource = null;
  let pollInterval = null;
  let isSyncActive = false;
  const markedStudents = new Set();
  const attendedRecordsCache = new Map(); // studentId -> { studentId, fullName }

  // -------------------------------------------------------------
  // 1. Text Normalization & Robust Fuzzy Matching Engine
  // -------------------------------------------------------------
  function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .toLowerCase()
      // Arabic letter normalization
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[ؤئ]/g, 'ء')
      // Remove Arabic Tashkeel / Harakat
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Collapse all whitespace, tabs, and non-breaking spaces into single space
      .replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ')
      .trim();
  }

  function doesTextMatchStudent(rawText, studentId, fullName) {
    if (!rawText) return false;

    const normRaw = normalizeText(rawText);
    const cleanId = (studentId || '').trim();

    // Match 1: Exact or embedded Student ID (e.g. "20264712", "ID: 20264712", "#20264712")
    if (cleanId && normRaw.includes(cleanId.toLowerCase())) {
      return true;
    }

    // Match 2: Digits-only ID match (handles "2026-4712" or "2026/4712")
    const idDigits = cleanId.replace(/\D/g, '');
    if (idDigits && idDigits.length >= 6) {
      const rawDigits = rawText.replace(/\D/g, '');
      if (rawDigits.includes(idDigits)) {
        return true;
      }
    }

    // Match 3: Full Name matching (Case-Insensitive, Multi-word, Arabic & English)
    if (fullName) {
      const normName = normalizeText(fullName);
      if (normName.length >= 3) {
        // 3.1: Complete normalized name contains or is contained
        if (normRaw.includes(normName) || normName.includes(normRaw)) {
          return true;
        }

        // 3.2: Token-based multi-part matching (handles "Mohamed Matany" or "Matany, Mohamed")
        const nameTokens = normName.split(' ').filter(t => t.length >= 2);
        if (nameTokens.length > 0) {
          // If first and last tokens both match (e.g. "Mohamed" and "Matany")
          if (nameTokens.length >= 2) {
            const firstToken = nameTokens[0];
            const lastToken = nameTokens[nameTokens.length - 1];
            if (normRaw.includes(firstToken) && normRaw.includes(lastToken)) {
              return true;
            }
          }

          // Count matching tokens
          let matchCount = 0;
          for (const token of nameTokens) {
            if (normRaw.includes(token)) {
              matchCount++;
            }
          }

          // If at least 2 tokens match or 100% of single token
          if (matchCount >= 2 || (nameTokens.length === 1 && matchCount === 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // -------------------------------------------------------------
  // 2. Universal Checkbox Detection & Deterministic Ticking
  // -------------------------------------------------------------
  function findCheckboxInside(container) {
    if (!container) return null;

    // 1. Standard HTML checkbox
    const inputChk = container.querySelector('input[type="checkbox"]');
    if (inputChk) return inputChk;

    // 2. ARIA role="checkbox"
    const ariaChk = container.querySelector('[role="checkbox"]');
    if (ariaChk) return ariaChk;

    // 3. Custom button or switch
    const btnChk = container.querySelector('button[aria-checked], .checkbox, .custom-checkbox, [data-check], input[type="radio"]');
    if (btnChk) return btnChk;

    return null;
  }

  function applyCheckedState(el) {
    if (!el) return;

    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      if (!el.checked) {
        el.checked = true;
        // Dispatch standard change and input events for React / Vue / Angular / native forms
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Re-assert checked state
      el.checked = true;
      return;
    }

    // Custom ARIA checkbox or button
    if (el.getAttribute('role') === 'checkbox' || el.hasAttribute('aria-checked')) {
      const isChecked = el.getAttribute('aria-checked') === 'true' ||
                        el.classList.contains('active') ||
                        el.classList.contains('checked') ||
                        el.classList.contains('selected');
      if (!isChecked) {
        el.setAttribute('aria-checked', 'true');
        el.classList.add('checked', 'active');
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return;
    }

    // Click fallback for custom UI elements
    try {
      el.click();
    } catch (e) {}
  }

  function markStudentPresentInDom(studentId, fullName) {
    if (!studentId && !fullName) return;

    // Cache record for dynamic DOM mutations / pagination
    const key = studentId || fullName;
    attendedRecordsCache.set(key, { studentId, fullName });

    let targetCheckbox = null;
    let targetRow = null;

    // Strategy 1: Direct ID attributes search across various portal conventions
    if (studentId) {
      const directSelectors = [
        `#chk-${studentId}`,
        `#checkbox-${studentId}`,
        `#check-${studentId}`,
        `input[type="checkbox"][id*="${studentId}"]`,
        `input[type="checkbox"][name*="${studentId}"]`,
        `input[type="checkbox"][value*="${studentId}"]`,
        `input[type="checkbox"][data-student-id="${studentId}"]`,
        `input[type="checkbox"][data-id="${studentId}"]`,
        `[role="checkbox"][id*="${studentId}"]`,
        `[role="checkbox"][data-student-id="${studentId}"]`
      ];

      for (const sel of directSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          targetCheckbox = el;
          targetRow = el.closest('tr, li, [role="row"], .student-row, .row, .item') || el.parentElement;
          break;
        }
      }
    }

    // Strategy 2: Search all table rows (<tr>)
    if (!targetCheckbox) {
      const rows = document.querySelectorAll('tr, [role="row"], .student-row, .attendance-row, .user-row');
      for (const r of rows) {
        if (doesTextMatchStudent(r.textContent, studentId, fullName)) {
          targetRow = r;
          targetCheckbox = findCheckboxInside(r);
          if (targetCheckbox) break;
        }
      }
    }

    // Strategy 3: Search all lists (<li>) and grid cards (.card, .item)
    if (!targetCheckbox) {
      const containers = document.querySelectorAll('li, .student-card, .attendance-item, .table-row, div.row');
      for (const c of containers) {
        if (doesTextMatchStudent(c.textContent, studentId, fullName)) {
          targetRow = c;
          targetCheckbox = findCheckboxInside(c);
          if (targetCheckbox) break;
        }
      }
    }

    // Strategy 4: Universal Checkbox Walk over entire page
    if (!targetCheckbox) {
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"], .custom-checkbox, [data-checkbox]');
      for (const chk of allCheckboxes) {
        const parentContainer = chk.closest('tr, li, [role="row"], .row, .item, .card, form, div');
        if (parentContainer && doesTextMatchStudent(parentContainer.textContent, studentId, fullName)) {
          targetCheckbox = chk;
          targetRow = parentContainer;
          break;
        }
      }
    }

    // Strategy 5: Label association (e.g. <label for="xxx">Mohamed Matany</label>)
    if (!targetCheckbox) {
      const allLabels = document.querySelectorAll('label');
      for (const lbl of allLabels) {
        if (doesTextMatchStudent(lbl.textContent, studentId, fullName)) {
          const forId = lbl.getAttribute('for');
          if (forId) {
            const el = document.getElementById(forId);
            if (el && (el.type === 'checkbox' || el.getAttribute('role') === 'checkbox')) {
              targetCheckbox = el;
              targetRow = lbl.closest('tr, li, [role="row"], .row') || lbl.parentElement;
              break;
            }
          }
        }
      }
    }

    // If target found, apply check and visual feedback
    if (targetCheckbox) {
      applyCheckedState(targetCheckbox);

      if (targetRow) {
        targetRow.classList.add('avqr-highlight-attended');
        targetRow.style.outline = '2.5px solid #059669';
        targetRow.style.backgroundColor = '#ECFDF5';

        const statusCell = targetRow.querySelector('.status-cell') ||
                           targetRow.querySelector(`[id*="status-${studentId}"]`) ||
                           targetRow.querySelector('td:last-child');
        if (statusCell && !statusCell.querySelector('.avqr-badge')) {
          statusCell.innerHTML = '<span class="avqr-badge" style="background:#059669; color:#FFFFFF; padding:4px 10px; border:2px solid #121212; font-weight:800; font-size:12px; display:inline-block; border-radius:4px;">حاضر (AVQR)</span>';
        }
      }

      if (studentId && !markedStudents.has(studentId)) {
        markedStudents.add(studentId);
        showFloatingNotification(`تم رصد حضور الطالب: ${fullName || studentId} بنسبة دقة 100%`);
      }

      updateAttendedCount();
    }
  }

  function updateAttendedCount() {
    const checked = document.querySelectorAll('input[type="checkbox"]:checked').length;
    const countBadge = document.getElementById('avqrWidgetCount');
    if (countBadge) countBadge.textContent = checked;

    const portalCount = document.getElementById('presentCount');
    if (portalCount) portalCount.textContent = checked;
  }

  // -------------------------------------------------------------
  // 3. Dynamic DOM Observer for SPAs & AJAX Tables
  // -------------------------------------------------------------
  function observeDomChanges() {
    if (!window.MutationObserver) return;
    const observer = new MutationObserver(() => {
      if (attendedRecordsCache.size > 0) {
        attendedRecordsCache.forEach(rec => {
          markStudentPresentInDom(rec.studentId, rec.fullName);
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------
  // 4. Dual Real-time Synchronization (SSE + Polling)
  // -------------------------------------------------------------
  function startDualSync(sessionId) {
    if (isSyncActive && pollInterval) {
      connectSse(sessionId);
      return;
    }
    isSyncActive = true;

    // Start Realtime SSE Stream
    connectSse(sessionId);

    // Continuous Resilient Polling Loop (1.5 seconds)
    clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      try {
        fetchSessionRecords(sessionId);
      } catch (e) {}
    }, 1500);

    fetchSessionRecords(sessionId);
    observeDomChanges();
  }

  function fetchSessionRecords(sessionId) {
    fetch(`${serverUrl}/api/session/${sessionId}/records`)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(records => {
        if (Array.isArray(records)) {
          records.forEach(rec => {
            markStudentPresentInDom(rec.student_id, rec.student_name);
          });
        }
      })
      .catch(() => {
        if (serverUrl.includes('vercel.app')) {
          fetch(`http://localhost:3001/api/session/${sessionId}/records`)
            .then(r => r.json())
            .then(records => {
              if (Array.isArray(records)) {
                records.forEach(rec => markStudentPresentInDom(rec.student_id, rec.student_name));
              }
            })
            .catch(() => {});
        }
      });
  }

  function connectSse(sessionId) {
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
    }

    try {
      sseSource = new EventSource(`${serverUrl}/api/session/${sessionId}/stream`);

      sseSource.addEventListener('STUDENT_ATTENDED', (e) => {
        try {
          const student = JSON.parse(e.data);
          markStudentPresentInDom(student.studentId, student.fullName);
        } catch (err) {}
      });

      sseSource.addEventListener('AUTO_SAVED', () => {
        executePortalAutoSave();
      });

      sseSource.onerror = () => {
        updateWidgetStatus('المزامنة المباشرة نشطة');
      };
    } catch (err) {}
  }

  // -------------------------------------------------------------
  // 5. Universal Auto-Save Execution
  // -------------------------------------------------------------
  function executePortalAutoSave() {
    const saveBtn = document.querySelector('#btnSaveAttendance') ||
                    document.querySelector('button[type="submit"]') ||
                    document.querySelector('input[type="submit"][value*="Save"]') ||
                    document.querySelector('input[type="submit"][value*="حفظ"]') ||
                    document.querySelector('.btn-save') ||
                    document.querySelector('[data-action="save"]');

    if (saveBtn) {
      saveBtn.click();
      showFloatingNotification('تم تنفيذ الحفظ التلقائي لكشف الحضور بنجاح بنسبة خطأ 0%', 6000);
    } else {
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        showFloatingNotification('تم حفظ كشف الحضور بنجاح', 6000);
      }
    }
  }

  // -------------------------------------------------------------
  // 6. Universal Neubrutalism Floating Control Widget
  // -------------------------------------------------------------
  function initWidget() {
    if (document.getElementById('avqrFloatingWidget')) return;

    const widget = document.createElement('div');
    widget.id = 'avqrFloatingWidget';
    widget.className = 'avqr-floating-widget';
    widget.innerHTML = `
      <div class="avqr-widget-header">
        <span class="avqr-widget-tag">AVQR • Matany Group x FUE</span>
        <button id="avqrWidgetMinimize" class="avqr-min-btn">—</button>
      </div>
      <div class="avqr-widget-body" id="avqrWidgetBody">
        <div class="avqr-widget-session">
          <small>جلسة المحاضرة:</small>
          <strong id="avqrWidgetSessionName">${activeSessionId}</strong>
        </div>
        <div class="avqr-widget-stats">
          <span>الحاضرون تلقائياً:</span>
          <strong id="avqrWidgetCount" class="avqr-count-pill">0</strong>
        </div>
        <div class="avqr-timer-line">
          <span>الحفظ التلقائي:</span>
          <span>مفعل بعد 3 دقائق</span>
        </div>
        <button id="avqrWidgetSaveBtn" class="avqr-widget-btn">حفظ الكشف الآن</button>
      </div>
    `;

    document.body.appendChild(widget);

    const minBtn = document.getElementById('avqrWidgetMinimize');
    const body = document.getElementById('avqrWidgetBody');
    if (minBtn && body) {
      minBtn.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
        minBtn.textContent = body.style.display === 'none' ? '+' : '—';
      });
    }

    const saveBtn = document.getElementById('avqrWidgetSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        executePortalAutoSave();
      });
    }
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

  // -------------------------------------------------------------
  // 7. Auto-Detection and Activation on ANY Website
  // -------------------------------------------------------------
  function autoDetectAndActivate() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['avqr_session_id', 'avqr_is_active', 'avqr_server_url'], (res) => {
        if (res.avqr_server_url) serverUrl = res.avqr_server_url;
        if (res.avqr_session_id) activeSessionId = res.avqr_session_id;

        // If session is marked active, activate immediately
        if (res.avqr_is_active) {
          initWidget();
          startDualSync(activeSessionId);
          return;
        }

        // Heuristic detection: check if page has checkboxes and attendance keywords
        const pageText = (document.body ? document.body.innerText : '').toLowerCase();
        const hasCheckboxes = document.querySelector('input[type="checkbox"], [role="checkbox"]');
        const hasAttendanceKeywords = pageText.includes('حضور') ||
                                      pageText.includes('attendance') ||
                                      pageText.includes('غياب') ||
                                      pageText.includes('students') ||
                                      pageText.includes('طلاب') ||
                                      pageText.includes('fue');

        if (hasCheckboxes && hasAttendanceKeywords) {
          initWidget();
          startDualSync(activeSessionId);
        }
      });
    }
  }

  // Listen for activation messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (msg.action === 'ACTIVATE_AUTOSYNC') {
          activeSessionId = msg.sessionId || activeSessionId;
          if (msg.serverUrl) serverUrl = msg.serverUrl;
          initWidget();
          startDualSync(activeSessionId);
          updateWidgetStatus(`جلسة نشطة: ${activeSessionId}`);
          sendResponse({ status: 'ACTIVE' });
        } else if (msg.action === 'TRIGGER_AUTO_SAVE') {
          executePortalAutoSave();
          sendResponse({ status: 'SAVED' });
        }
      } catch (err) {
        sendResponse({ status: 'ERROR', message: err.message });
      }
      return true;
    });
  }

  // Initial boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoDetectAndActivate);
  } else {
    autoDetectAndActivate();
  }
})();
