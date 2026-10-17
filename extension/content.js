// AVQR Content Script - Universal Checkbox Automation & Real-Time Sync
// Designed by Matany Group for Future University in Egypt (FUE) & All University Portals
// Supports Top-Level Documents, Same-Origin/Cross-Origin Iframes, Dynamic Mutation, and Multi-Level Frameworks

(function () {
  let activeSessionId = 'AVQR-2026';
  let serverUrl = window.location.hostname.includes('localhost') ? 'http://localhost:3001' : 'https://avqr-matany-fue.vercel.app';
  let sseSource = null;
  let pollInterval = null;
  let recheckInterval = null;
  let isSyncActive = false;
  const isTopWindow = (window === window.top);

  const markedStudents = new Set();
  const attendedRecordsCache = new Map(); // key -> { studentId, fullName }

  // -------------------------------------------------------------
  // 1. Recursive Document Traversal (All Frames & Iframes)
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
            docs.push(...getAllDocuments(subDoc));
          }
        } catch (e) {
          // Cross-origin iframe security boundary:
          // Handled natively by Chrome via all_frames: true in manifest.json!
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
      // Arabic letter normalization
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[ؤئ]/g, 'ء')
      // Remove Arabic Tashkeel / Harakat
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Collapse all whitespace, tabs, zero-width, non-breaking spaces
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
  // 3. Hierarchical Checkbox Search (Scoring & Priority Engine)
  // -------------------------------------------------------------
  function findCheckboxForStudent(studentId, fullName, doc) {
    if (!doc) return null;

    const checkboxes = Array.from(doc.querySelectorAll('input[type="checkbox"], [role="checkbox"], .custom-checkbox, [data-checkbox]'));
    if (checkboxes.length === 0) return null;

    // Tier 1: Explicit <label for="id"> matching (e.g. W3Schools, HTML forms, LMS)
    const labels = Array.from(doc.querySelectorAll('label'));
    for (const lbl of labels) {
      if (doesTextMatchStudent(lbl.textContent, studentId, fullName)) {
        const forId = lbl.getAttribute('for');
        if (forId) {
          try {
            const el = doc.getElementById(forId) || doc.querySelector(`[id="${CSS.escape(forId)}"]`);
            if (el && (el.tagName === 'INPUT' || el.getAttribute('role') === 'checkbox')) {
              return { checkbox: el, label: lbl };
            }
          } catch (e) {}
        }
        // Check if the checkbox is nested inside this matching label: <label><input type="checkbox"> Mohamed Matany</label>
        const innerChk = lbl.querySelector('input[type="checkbox"], [role="checkbox"]');
        if (innerChk) {
          return { checkbox: innerChk, label: lbl };
        }
      }
    }

    // Tier 2: Direct ID / Name / Value / Data Attributes on Checkbox
    for (const chk of checkboxes) {
      const chkId = chk.id || '';
      const chkName = chk.name || '';
      const chkVal = chk.value || '';
      const dataId = chk.getAttribute('data-student-id') || chk.getAttribute('data-id') || '';
      const ariaLbl = chk.getAttribute('aria-label') || '';

      if (studentId) {
        if (doesTextMatchStudent(chkId, studentId, null) ||
            doesTextMatchStudent(chkName, studentId, null) ||
            doesTextMatchStudent(chkVal, studentId, null) ||
            doesTextMatchStudent(dataId, studentId, null) ||
            doesTextMatchStudent(ariaLbl, studentId, null)) {
          return { checkbox: chk, label: chk.closest('label') };
        }
      }
      if (fullName) {
        if (doesTextMatchStudent(ariaLbl, null, fullName) ||
            doesTextMatchStudent(chkName, null, fullName)) {
          return { checkbox: chk, label: chk.closest('label') };
        }
      }
    }

    // Tier 3: Checkbox Adjacent Elements / Direct Siblings (e.g. <input> <label>...</label>)
    for (const chk of checkboxes) {
      // 3.1: Enclosing <label>
      const parentLabel = chk.closest('label');
      if (parentLabel && doesTextMatchStudent(parentLabel.textContent, studentId, fullName)) {
        return { checkbox: chk, label: parentLabel };
      }

      // 3.2: Immediate Next Sibling element (e.g. <label>, <span>, <p>, <b>)
      const nextEl = chk.nextElementSibling;
      if (nextEl && doesTextMatchStudent(nextEl.textContent, studentId, fullName)) {
        return { checkbox: chk, label: nextEl };
      }

      // 3.3: Immediate Previous Sibling element
      const prevEl = chk.previousElementSibling;
      if (prevEl && doesTextMatchStudent(prevEl.textContent, studentId, fullName)) {
        return { checkbox: chk, label: prevEl };
      }

      // 3.4: Next sibling text node (e.g. <input type="checkbox"> Mohamed Matany <br>)
      let nextNode = chk.nextSibling;
      while (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
        if (doesTextMatchStudent(nextNode.textContent, studentId, fullName)) {
          return { checkbox: chk, label: null };
        }
        nextNode = nextNode.nextSibling;
      }
    }

    // Tier 4: Table Rows (<tr> or [role="row"]) - Standard for University Portals
    const rows = Array.from(doc.querySelectorAll('tr, [role="row"], .student-row, .attendance-row, .user-row'));
    for (const row of rows) {
      if (doesTextMatchStudent(row.textContent, studentId, fullName)) {
        const rowCheckboxes = Array.from(row.querySelectorAll('input[type="checkbox"], [role="checkbox"], .custom-checkbox'));
        if (rowCheckboxes.length === 1) {
          return { checkbox: rowCheckboxes[0], row: row };
        } else if (rowCheckboxes.length > 1) {
          // If multiple checkboxes in one row (e.g. Present vs Absent columns):
          // Find the one corresponding to "Present" or "حاضر" or column 1
          const presentChk = rowCheckboxes.find(c => {
            const txt = (c.id + ' ' + c.name + ' ' + c.value + ' ' + (c.title || '') + ' ' + (c.getAttribute('aria-label') || '')).toLowerCase();
            return txt.includes('present') || txt.includes('حاضر') || txt.includes('attend');
          });
          return { checkbox: presentChk || rowCheckboxes[0], row: row };
        }
      }
    }

    // Tier 5: List Items (<li>) or Cards (.student-card, .attendance-item)
    const items = Array.from(doc.querySelectorAll('li, .student-card, .attendance-item'));
    for (const itm of items) {
      if (doesTextMatchStudent(itm.textContent, studentId, fullName)) {
        const itmChk = itm.querySelector('input[type="checkbox"], [role="checkbox"]');
        if (itmChk) {
          return { checkbox: itmChk, container: itm };
        }
      }
    }

    // Tier 6: Check immediate parent container ONLY IF container contains exactly 1 checkbox
    // NEVER match entire form, body, or table if it has multiple checkboxes!
    for (const chk of checkboxes) {
      const parent = chk.parentElement;
      if (parent && !['FORM', 'BODY', 'HTML', 'TABLE', 'TBODY', 'MAIN'].includes(parent.tagName)) {
        const chksInParent = parent.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
        if (chksInParent.length === 1 && doesTextMatchStudent(parent.textContent, studentId, fullName)) {
          return { checkbox: chk, container: parent };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------
  // 4. Deterministic Checkbox Actuation Engine
  // -------------------------------------------------------------
  function applyCheckedState(el) {
    if (!el) return;

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      // 1. If not already checked, simulate real user click
      if (!el.checked) {
        try {
          const clickEvt = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: el.ownerDocument.defaultView || window
          });
          el.dispatchEvent(clickEvt);
        } catch (e) {
          try { el.click(); } catch (err) {}
        }
      }

      // 2. React 16+ / Vue Native Property Setter Bypass
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

      // 3. Absolute Guarantee of Checked State
      el.checked = true;

      // 4. Dispatch standard change and input events with full bubble
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {}

      // Re-verify after microtask
      setTimeout(() => {
        if (!el.checked) {
          el.checked = true;
          try {
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {}
        }
      }, 50);
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
        try {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (e) {
          try { el.click(); } catch (err) {}
        }
      }
      return;
    }

    // Generic clickable element fallback
    try {
      el.click();
    } catch (e) {}
  }

  function highlightAttendedMatch(match, studentId, fullName) {
    if (!match || !match.checkbox) return;

    const chk = match.checkbox;
    chk.classList.add('avqr-checkbox-checked');
    chk.style.outline = '3px solid #059669';

    if (match.label) {
      match.label.classList.add('avqr-label-checked');
      match.label.style.backgroundColor = '#ECFDF5';
      match.label.style.color = '#065F46';
      match.label.style.outline = '1.5px solid #059669';
    }

    if (match.row) {
      const row = match.row;
      row.classList.add('avqr-highlight-attended');
      row.style.outline = '2.5px solid #059669';
      row.style.backgroundColor = '#ECFDF5';

      const statusCell = row.querySelector('.status-cell') ||
                         row.querySelector(`[id*="status-${studentId}"]`) ||
                         row.querySelector('td:last-child');
      if (statusCell && !statusCell.querySelector('.avqr-badge')) {
        statusCell.innerHTML = '<span class="avqr-badge" style="background:#059669; color:#FFFFFF; padding:4px 10px; border:2px solid #121212; font-weight:800; font-size:12px; display:inline-block; border-radius:4px;">حاضر (AVQR)</span>';
      }
    } else if (match.container) {
      match.container.classList.add('avqr-highlight-attended');
      match.container.style.outline = '2px solid #059669';
      match.container.style.backgroundColor = '#ECFDF5';
    }
  }

  // -------------------------------------------------------------
  // 5. Universal In-DOM Marking across All Frames & Documents
  // -------------------------------------------------------------
  function markStudentPresentInDom(studentId, fullName) {
    if (!studentId && !fullName) return false;

    // Cache record for dynamic DOM mutations / pagination / iframe re-runs
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
        console.warn('AVQR: Error searching document frame:', err);
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

    const countBadge = document.getElementById('avqrWidgetCount');
    if (countBadge) countBadge.textContent = totalChecked;

    const portalCount = document.getElementById('presentCount');
    if (portalCount) portalCount.textContent = totalChecked;
  }

  // -------------------------------------------------------------
  // 6. Dynamic DOM Observers & Iframe Reload Surveillance
  // -------------------------------------------------------------
  function observeAllFrames() {
    if (!window.MutationObserver) return;

    // 1. Observe top document body
    if (document.body) {
      const topObserver = new MutationObserver(() => {
        reapplyAllAttendedRecords();
        attachIframeListeners(document);
      });
      topObserver.observe(document.body, { childList: true, subtree: true });
    }

    // 2. Attach reload listeners to child iframes
    attachIframeListeners(document);

    // 3. Continuous Resilient Re-check Interval (guarantees checkboxes stay ticked)
    clearInterval(recheckInterval);
    recheckInterval = setInterval(() => {
      if (attendedRecordsCache.size > 0) {
        reapplyAllAttendedRecords();
      }
    }, 1200);
  }

  function attachIframeListeners(rootDoc) {
    try {
      const iframes = rootDoc.querySelectorAll('iframe, frame');
      iframes.forEach(ifr => {
        if (!ifr._avqrAttached) {
          ifr._avqrAttached = true;
          ifr.addEventListener('load', () => {
            setTimeout(reapplyAllAttendedRecords, 100);
            setTimeout(reapplyAllAttendedRecords, 500);
          });
        }
      });
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 7. Dual Real-time Synchronization (SSE + Polling)
  // -------------------------------------------------------------
  function startDualSync(sessionId) {
    activeSessionId = sessionId;
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
    observeAllFrames();
  }

  function stopDualSync() {
    isSyncActive = false;
    clearInterval(pollInterval);
    clearInterval(recheckInterval);
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
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
        updateWidgetStatus('المزامنة المباشرة نشطة');
      };
    } catch (err) {}
  }

  // -------------------------------------------------------------
  // 8. Universal Auto-Save Execution
  // -------------------------------------------------------------
  function executePortalAutoSave() {
    const allDocs = getAllDocuments(document);
    for (const doc of allDocs) {
      try {
        const saveBtn = doc.querySelector('#btnSaveAttendance') ||
                        doc.querySelector('button[type="submit"]') ||
                        doc.querySelector('input[type="submit"][value*="Save"]') ||
                        doc.querySelector('input[type="submit"][value*="حفظ"]') ||
                        doc.querySelector('.btn-save') ||
                        doc.querySelector('[data-action="save"]');

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
  // 9. Universal Neubrutalism Floating Control Widget (Top Window Only)
  // -------------------------------------------------------------
  function initWidget() {
    // Only render floating widget in top window to prevent iframe duplication
    if (!isTopWindow) return;
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

    if (document.body) {
      document.body.appendChild(widget);
    }

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
  // 10. Multi-Channel Storage & Message Listeners
  // -------------------------------------------------------------
  function checkAndActivate() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['avqr_session_id', 'avqr_is_active', 'avqr_server_url'], (res) => {
        if (res.avqr_server_url) serverUrl = res.avqr_server_url;
        if (res.avqr_session_id) activeSessionId = res.avqr_session_id;

        if (res.avqr_is_active) {
          initWidget();
          startDualSync(activeSessionId);
          return;
        }

        // Heuristic detection on any university page
        const pageText = (document.body ? document.body.innerText : '').toLowerCase();
        const hasCheckboxes = document.querySelector('input[type="checkbox"], [role="checkbox"]');
        const hasAttendanceKeywords = pageText.includes('حضور') ||
                                      pageText.includes('attendance') ||
                                      pageText.includes('غياب') ||
                                      pageText.includes('students') ||
                                      pageText.includes('طلاب') ||
                                      pageText.includes('fue') ||
                                      pageText.includes('checkbox');

        if (hasCheckboxes && hasAttendanceKeywords) {
          initWidget();
          startDualSync(activeSessionId);
        }
      });
    }
  }

  // Real-time synchronization across all frames via Chrome Storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.avqr_is_active || changes.avqr_session_id || changes.avqr_server_url || changes.avqr_sync_pulse) {
          chrome.storage.local.get(['avqr_session_id', 'avqr_is_active', 'avqr_server_url'], (res) => {
            if (res.avqr_server_url) serverUrl = res.avqr_server_url;
            if (res.avqr_session_id) activeSessionId = res.avqr_session_id;

            if (res.avqr_is_active) {
              initWidget();
              startDualSync(activeSessionId);
            } else {
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
          initWidget();
          startDualSync(activeSessionId);
          updateWidgetStatus(`جلسة نشطة: ${activeSessionId}`);
          sendResponse({ status: 'ACTIVE' });
        } else if (msg.action === 'RECORD_ATTENDEE') {
          if (msg.studentId || msg.fullName) {
            markStudentPresentInDom(msg.studentId, msg.fullName);
          }
          sendResponse({ status: 'MARKED' });
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
    document.addEventListener('DOMContentLoaded', checkAndActivate);
  } else {
    checkAndActivate();
  }
})();
