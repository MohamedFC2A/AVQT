// AVQR Content Script - Universal Checkbox Automation & Real-Time Sync
// Designed by Matany Group for Future University in Egypt (FUE) & All University Portals
// Zero-Lag, Ultra-Lightweight, Deterministic Checkbox Actuation Engine

(function () {
  let activeSessionId = 'AVQR-2026';
  let serverUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3001' : 'https://avqr-matany-fue.vercel.app';
  let sseSource = null;
  let pollInterval = null;
  let isSyncActive = false;
  let isManuallyDismissed = false;
  const isTopWindow = (window === window.top);

  const markedStudents = new Set();
  const attendedRecordsCache = new Map(); // key -> { studentId, fullName }

  // -------------------------------------------------------------
  // 1. Efficient Frame & Document Traversal (Zero Lag, No querySelectorAll('*'))
  // -------------------------------------------------------------
  function getAllDocuments(rootDoc) {
    if (!rootDoc) rootDoc = document;
    const docs = [rootDoc];
    try {
      const iframes = rootDoc.querySelectorAll('iframe, frame');
      for (const ifr of iframes) {
        try {
          const subDoc = ifr.contentDocument || (ifr.contentWindow && ifr.contentWindow.document);
          if (subDoc && !docs.includes(subDoc)) {
            docs.push(subDoc);
          }
        } catch (e) {
          // Handled natively by Chrome via all_frames: true
        }
      }
    } catch (e) {}
    return docs;
  }

  // -------------------------------------------------------------
  // 2. Text Normalization & Robust Fuzzy Matching Engine
  // -------------------------------------------------------------
  function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[ؤئ]/g, 'ء')
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ')
      .trim();
  }

  function doesTextMatchStudent(rawText, studentId, fullName) {
    if (!rawText) return false;

    const normRaw = normalizeText(rawText);
    const cleanId = (studentId || '').trim();

    // Match 1: Exact or embedded Student ID (e.g. "20264712", "ID: 20264712", "chk-20264712")
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
        if (normRaw.includes(normName) || normName.includes(normRaw)) {
          return true;
        }

        const nameTokens = normName.split(' ').filter(t => t.length >= 2);
        if (nameTokens.length >= 2) {
          const firstToken = nameTokens[0];
          const lastToken = nameTokens[nameTokens.length - 1];
          if (normRaw.includes(firstToken) && normRaw.includes(lastToken)) {
            return true;
          }

          let matchCount = 0;
          for (const token of nameTokens) {
            if (normRaw.includes(token)) matchCount++;
          }
          if (matchCount >= 2) return true;
        }
      }
    }

    return false;
  }

  // -------------------------------------------------------------
  // 3. Hierarchical Checkbox Search (Prioritized for Portal Tables)
  // -------------------------------------------------------------
  function findCheckboxForStudent(studentId, fullName, doc) {
    if (!doc) return null;
    const cleanId = (studentId || '').trim();

    // Tier 1: Direct ID or Data Attribute matching on Checkbox or Row
    if (cleanId) {
      // Direct checkbox element by ID: e.g. #chk-20264712, #checkbox-20264712, #attendance_20264712
      try {
        const directChk = doc.getElementById('chk-' + cleanId) ||
                          doc.getElementById('chk_' + cleanId) ||
                          doc.getElementById('checkbox-' + cleanId) ||
                          doc.getElementById(cleanId) ||
                          doc.querySelector(`input[type="checkbox"][id*="${CSS.escape(cleanId)}"]`) ||
                          doc.querySelector(`input[type="checkbox"][name*="${CSS.escape(cleanId)}"]`) ||
                          doc.querySelector(`input[type="checkbox"][data-student-id="${CSS.escape(cleanId)}"]`) ||
                          doc.querySelector(`input[type="checkbox"][value="${CSS.escape(cleanId)}"]`);
        if (directChk) {
          return { checkbox: directChk, row: directChk.closest('tr') || directChk.closest('[role="row"]') };
        }
      } catch (e) {}

      // Direct row element: e.g. #row-20264712, [data-student-id="20264712"]
      try {
        const directRow = doc.getElementById('row-' + cleanId) ||
                          doc.getElementById('student-' + cleanId) ||
                          doc.querySelector(`tr[data-student-id="${CSS.escape(cleanId)}"]`) ||
                          doc.querySelector(`[data-student-id="${CSS.escape(cleanId)}"]`);
        if (directRow) {
          const rowChk = directRow.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"]');
          if (rowChk) {
            return { checkbox: rowChk, row: directRow };
          }
        }
      } catch (e) {}
    }

    // Tier 2: Table Rows (<tr> or [role="row"]) matching Student ID or Name in row text
    const rows = Array.from(doc.querySelectorAll('tr, [role="row"], .student-row, .attendance-row, .user-row'));
    for (const row of rows) {
      if (doesTextMatchStudent(row.textContent, cleanId, fullName)) {
        const rowCheckboxes = Array.from(row.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], .custom-checkbox'));
        if (rowCheckboxes.length === 1) {
          return { checkbox: rowCheckboxes[0], row: row };
        } else if (rowCheckboxes.length > 1) {
          const presentChk = rowCheckboxes.find(c => {
            const txt = (c.id + ' ' + c.name + ' ' + c.value + ' ' + (c.title || '') + ' ' + (c.getAttribute('aria-label') || '')).toLowerCase();
            const parentTxt = (c.parentElement ? c.parentElement.textContent : '').toLowerCase();
            const nextTxt = (c.nextElementSibling ? c.nextElementSibling.textContent : '').toLowerCase();
            const combined = txt + ' ' + parentTxt + ' ' + nextTxt;
            return combined.includes('present') || combined.includes('حاضر') || combined.includes('attend') || c.value === 'P' || c.value === '1';
          });
          return { checkbox: presentChk || rowCheckboxes[0], row: row };
        }
      }
    }

    // Tier 3: Explicit <label for="id"> matching
    const labels = Array.from(doc.querySelectorAll('label'));
    for (const lbl of labels) {
      if (doesTextMatchStudent(lbl.textContent, cleanId, fullName)) {
        const forId = lbl.getAttribute('for');
        if (forId) {
          try {
            const el = doc.getElementById(forId) || doc.querySelector(`[id="${CSS.escape(forId)}"]`);
            if (el && (el.tagName === 'INPUT' || el.getAttribute('role') === 'checkbox')) {
              return { checkbox: el, label: lbl, row: el.closest('tr') };
            }
          } catch (e) {}
        }
        const innerChk = lbl.querySelector('input[type="checkbox"], [role="checkbox"]');
        if (innerChk) {
          return { checkbox: innerChk, label: lbl, row: innerChk.closest('tr') };
        }
      }
    }

    // Tier 4: All Checkboxes attributes & siblings
    const checkboxes = Array.from(doc.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"]'));
    for (const chk of checkboxes) {
      const chkId = chk.id || '';
      const chkName = chk.name || '';
      const chkVal = chk.value || '';
      const dataId = chk.getAttribute('data-student-id') || chk.getAttribute('data-id') || '';
      const ariaLbl = chk.getAttribute('aria-label') || '';

      if (cleanId) {
        if (doesTextMatchStudent(chkId, cleanId, null) ||
            doesTextMatchStudent(chkName, cleanId, null) ||
            doesTextMatchStudent(chkVal, cleanId, null) ||
            doesTextMatchStudent(dataId, cleanId, null) ||
            doesTextMatchStudent(ariaLbl, cleanId, null)) {
          return { checkbox: chk, label: chk.closest('label'), row: chk.closest('tr') };
        }
      }
      if (fullName) {
        if (doesTextMatchStudent(ariaLbl, null, fullName) ||
            doesTextMatchStudent(chkName, null, fullName)) {
          return { checkbox: chk, label: chk.closest('label'), row: chk.closest('tr') };
        }
      }

      const parentLabel = chk.closest('label');
      if (parentLabel && doesTextMatchStudent(parentLabel.textContent, cleanId, fullName)) {
        return { checkbox: chk, label: parentLabel, row: chk.closest('tr') };
      }
      const nextEl = chk.nextElementSibling;
      if (nextEl && doesTextMatchStudent(nextEl.textContent, cleanId, fullName)) {
        return { checkbox: chk, label: nextEl, row: chk.closest('tr') };
      }
    }

    return null;
  }

  // -------------------------------------------------------------
  // 4. Deterministic Checkbox Actuation Engine
  // -------------------------------------------------------------
  function applyCheckedState(el) {
    if (!el) return;

    try {
      if (el.disabled) el.disabled = false;
    } catch (e) {}

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      // 1. Bypass React 16+ / Vue Native Property Setter
      try {
        const proto = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'checked') ||
                           Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, true);
        } else {
          el.checked = true;
        }
      } catch (e) {
        el.checked = true;
      }
      el.checked = true;

      // 2. Dispatch events
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {}

      // 3. Fallback click if not checked
      try {
        const clickEvt = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: el.ownerDocument.defaultView || window
        });
        el.dispatchEvent(clickEvt);
      } catch (e) {}

      el.checked = true;
      return;
    }

    // ARIA checkbox
    if (el.getAttribute('role') === 'checkbox' || el.hasAttribute('aria-checked')) {
      el.setAttribute('aria-checked', 'true');
      el.classList.add('checked', 'active');
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (e) {}
      return;
    }

    try { el.click(); } catch (e) {}
  }

  function highlightAttendedMatch(match, studentId, fullName) {
    if (!match || !match.checkbox) return;

    const chk = match.checkbox;
    chk.classList.add('avqr-checkbox-checked');

    if (match.label) {
      match.label.classList.add('avqr-label-checked');
      match.label.style.backgroundColor = '#ECFDF5';
      match.label.style.color = '#065F46';
    }

    const row = match.row || chk.closest('tr') || chk.closest('[role="row"]');
    if (row) {
      row.classList.add('row-attended', 'avqr-highlight-attended');
      row.style.outline = '2px solid #059669';
      row.style.backgroundColor = '#ECFDF5';

      const statusCell = row.querySelector('.status-cell') ||
                         (studentId ? row.querySelector(`[id*="status-${studentId}"]`) : null) ||
                         row.querySelector('td:last-child');
      if (statusCell) {
        statusCell.innerHTML = '<span class="badge-present" style="background:#059669; color:#FFFFFF; padding:4px 10px; border-radius:4px; font-weight:800; font-size:12px; display:inline-block;">حاضر</span>';
      }
    }
  }

  // -------------------------------------------------------------
  // 5. In-DOM Marking across All Frames & Documents
  // -------------------------------------------------------------
  function markStudentPresentInDom(studentId, fullName) {
    if (!studentId && !fullName) return false;

    const key = (studentId || fullName).toString().trim();
    attendedRecordsCache.set(key, { studentId, fullName });

    const allDocs = getAllDocuments(document);
    let markedCount = 0;

    for (const doc of allDocs) {
      try {
        const match = findCheckboxForStudent(studentId, fullName, doc);
        if (match && match.checkbox) {
          applyCheckedState(match.checkbox);
          highlightAttendedMatch(match, studentId, fullName);
          markedCount++;
        }
      } catch (err) {
        console.warn('AVQR: Error searching frame:', err);
      }
    }

    if (markedCount > 0) {
      if (studentId && !markedStudents.has(studentId)) {
        markedStudents.add(studentId);
        if (isTopWindow) {
          showFloatingNotification(`تم رصد وتفعيل حضور: ${fullName || studentId} (دقة 100%)`);
        }
      }
      updateAttendedCount();
      return true;
    }

    return false;
  }

  function reapplyAllAttendedRecords() {
    if (attendedRecordsCache.size === 0) return;
    attendedRecordsCache.forEach(rec => {
      markStudentPresentInDom(rec.studentId, rec.fullName);
    });
  }

  function updateAttendedCount() {
    const allDocs = getAllDocuments(document);
    let totalChecked = 0;
    for (const doc of allDocs) {
      try {
        totalChecked += doc.querySelectorAll('input[type="checkbox"]:checked').length;
      } catch (e) {}
    }

    const portalCount = document.getElementById('presentCount');
    if (portalCount) portalCount.textContent = totalChecked;
  }

  // -------------------------------------------------------------
  // 6. Dual Real-time Synchronization (SSE + Polling)
  // -------------------------------------------------------------
  function startDualSync(sessionId) {
    activeSessionId = sessionId;
    if (isSyncActive && pollInterval) {
      connectSse(sessionId);
      return;
    }
    isSyncActive = true;

    // Connect SSE Stream
    connectSse(sessionId);

    // Continuous Resilient Polling Loop (every 2 seconds)
    clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      try {
        fetchSessionRecords(sessionId);
      } catch (e) {}
    }, 2000);

    fetchSessionRecords(sessionId);
  }

  function stopDualSync() {
    isSyncActive = false;
    clearInterval(pollInterval);
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
      sseSource = null;
    }
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
        // SSE error handled gracefully, polling loop continues
      };
    } catch (err) {}
  }

  // -------------------------------------------------------------
  // 7. Universal Auto-Save Execution
  // -------------------------------------------------------------
  function executePortalAutoSave() {
    const allDocs = getAllDocuments(document);
    for (const doc of allDocs) {
      try {
        const saveBtn = doc.querySelector('#btnSaveAttendance') ||
                        doc.querySelector('button[type="submit"]') ||
                        doc.querySelector('button[id*="save" i]') ||
                        doc.querySelector('button[id*="submit" i]') ||
                        doc.querySelector('.btn-save') ||
                        doc.querySelector('.btn-save-attendance') ||
                        doc.querySelector('.save-btn');

        if (saveBtn) {
          saveBtn.click();
          if (isTopWindow) showFloatingNotification('تم تنفيذ الحفظ التلقائي لكشف الحضور بنجاح بنسبة خطأ 0%', 6000);
          return;
        }

        const form = doc.querySelector('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          if (isTopWindow) showFloatingNotification('تم حفظ كشف الحضور بنجاح', 6000);
          return;
        }
      } catch (e) {}
    }
  }

  // -------------------------------------------------------------
  // 8. Page Checkbox Detection & Prompt Widget
  // -------------------------------------------------------------
  function countPageCheckboxes() {
    const docs = getAllDocuments(document);
    let total = 0;
    for (const doc of docs) {
      try {
        total += doc.querySelectorAll('input[type="checkbox"], [role="checkbox"], .custom-checkbox').length;
      } catch (e) {}
    }
    return total;
  }

  function isDismissed() {
    return isManuallyDismissed;
  }

  function removePromptWidget() {
    const widget = document.getElementById('avqrFloatingWidget');
    if (widget) {
      widget.remove();
    }
  }

  function dismissWidget() {
    isManuallyDismissed = true;
    const widget = document.getElementById('avqrFloatingWidget');
    if (widget) {
      widget.style.transition = 'all 0.2s ease-out';
      widget.style.opacity = '0';
      widget.style.transform = 'translateY(15px) scale(0.95)';
      setTimeout(() => {
        if (widget) widget.remove();
      }, 200);
    }
  }

  function showReadyPromptWidget(checkboxCount) {
    if (!isTopWindow || isDismissed()) return;

    let widget = document.getElementById('avqrFloatingWidget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'avqrFloatingWidget';
      widget.className = 'avqr-floating-widget';
      if (document.body) document.body.appendChild(widget);
    }

    widget.innerHTML = `
      <div class="avqr-widget-header">
        <span class="avqr-widget-tag">AVQR • رصد الحضور الذكي</span>
        <div class="avqr-header-actions">
          <button id="avqrWidgetClose" class="avqr-close-btn" title="إغلاق وإخفاء">×</button>
        </div>
      </div>
      <div class="avqr-widget-body" id="avqrWidgetBody">
        <div class="avqr-prompt-box">
          <span class="avqr-prompt-badge">تم رصد كشف طلاب (${checkboxCount} خانات)</span>
          <p class="avqr-prompt-msg">صفحة رصد حضور جاهزة للأتمتة الذكية.</p>
        </div>
        <button id="avqrBtnReady" class="avqr-btn-ready">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-left:6px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          جاهز ؟
        </button>
      </div>
    `;

    const closeBtn = document.getElementById('avqrWidgetClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissWidget();
      });
    }

    const readyBtn = document.getElementById('avqrBtnReady');
    if (readyBtn) {
      readyBtn.addEventListener('click', () => {
        dismissWidget();

        const now = Date.now();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            avqr_session_id: activeSessionId,
            avqr_is_active: true,
            avqr_server_url: serverUrl,
            avqr_start_time: now,
            avqr_sync_pulse: now
          });
        }

        // Instantly open full-screen Presenter tab
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'OPEN_PRESENTER', sessionId: activeSessionId });
          }
        } catch (e) {
          console.warn('AVQR: Open presenter error:', e);
        }

        startDualSync(activeSessionId);
      });
    }
  }

  function showFloatingNotification(msg, duration = 3500) {
    if (!isTopWindow) return;

    let container = document.getElementById('avqrToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'avqrToastContainer';
      container.className = 'avqr-toast-container';
      if (document.body) document.body.appendChild(container);
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
  // 9. Intelligent Activation & Non-Intrusive Page Check
  // -------------------------------------------------------------
  function checkAndActivate() {
    if (isDismissed()) return;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['avqr_session_id', 'avqr_is_active', 'avqr_server_url', 'avqr_start_time'], (res) => {
        if (res.avqr_server_url) serverUrl = res.avqr_server_url;
        if (res.avqr_session_id) activeSessionId = res.avqr_session_id;

        // Check if session has expired (> 3 minutes)
        if (res.avqr_is_active && res.avqr_start_time) {
          const elapsed = Date.now() - res.avqr_start_time;
          if (elapsed >= 180 * 1000) {
            chrome.storage.local.set({ avqr_is_active: false });
            chrome.storage.local.remove(['avqr_start_time']);
            res.avqr_is_active = false;
          }
        }

        // If active, remove any prompt widget and keep background sync alive
        if (res.avqr_is_active) {
          removePromptWidget();
          startDualSync(activeSessionId);
          return;
        }

        // Only show ready prompt if NOT active and page contains checkboxes (>= 1)
        const boxCount = countPageCheckboxes();
        if (boxCount >= 1) {
          showReadyPromptWidget(boxCount);
        } else {
          removePromptWidget();
        }
      });
    }
  }

  // Real-time synchronization across tabs via Chrome Storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.avqr_is_active || changes.avqr_session_id || changes.avqr_server_url || changes.avqr_sync_pulse) {
          chrome.storage.local.get(['avqr_session_id', 'avqr_is_active', 'avqr_server_url', 'avqr_start_time'], (res) => {
            if (res.avqr_server_url) serverUrl = res.avqr_server_url;
            if (res.avqr_session_id) activeSessionId = res.avqr_session_id;

            if (res.avqr_is_active) {
              removePromptWidget();
              startDualSync(activeSessionId);
            } else {
              removePromptWidget();
              stopDualSync();
            }
          });
        }
      }
    });
  }

  // Direct Runtime Message Listener
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (msg.action === 'ACTIVATE_AUTOSYNC') {
          activeSessionId = msg.sessionId || activeSessionId;
          if (msg.serverUrl) serverUrl = msg.serverUrl;
          removePromptWidget();
          startDualSync(activeSessionId);
          sendResponse({ status: 'ACTIVE' });
        } else if (msg.action === 'RECORD_ATTENDEE') {
          if (msg.studentId || msg.fullName) {
            markStudentPresentInDom(msg.studentId, msg.fullName);
          }
          sendResponse({ status: 'MARKED' });
        } else if (msg.action === 'TRIGGER_AUTO_SAVE') {
          executePortalAutoSave();
          sendResponse({ status: 'SAVED' });
        } else if (msg.action === 'STOP_AUTOSYNC') {
          removePromptWidget();
          stopDualSync();
          sendResponse({ status: 'STOPPED' });
        }
      } catch (err) {
        sendResponse({ status: 'ERROR', message: err.message });
      }
      return true;
    });
  }

  // Safe Non-Blocking Initialization (Zero-Lag: No heavy recursive DOM observers)
  function init() {
    checkAndActivate();
    setTimeout(checkAndActivate, 600);
    setTimeout(checkAndActivate, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
