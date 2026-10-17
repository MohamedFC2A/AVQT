const SERVER_URL = 'http://localhost:3001';

let currentSessionId = 'AVQR-DEMO01';
let sseSource = null;
let timerInterval = null;
let remainingSeconds = 180; // 3 minutes default
const TOTAL_SECONDS = 180;

document.addEventListener('DOMContentLoaded', async () => {
  const sessionIdInput = document.getElementById('sessionIdInput');
  const btnNewSession = document.getElementById('btnNewSession');
  const btnOpenPresenter = document.getElementById('btnOpenPresenter');
  const btnStartAutoSync = document.getElementById('btnStartAutoSync');
  const btnForceSave = document.getElementById('btnForceSave');
  const serverStatusText = document.getElementById('serverStatusText');
  const livePresentCount = document.getElementById('livePresentCount');
  const studentsLiveList = document.getElementById('studentsLiveList');

  // Check saved session in storage
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['avqr_session_id', 'avqr_remaining_seconds'], (res) => {
      if (res.avqr_session_id) {
        currentSessionId = res.avqr_session_id;
        sessionIdInput.value = currentSessionId;
      }
      if (res.avqr_remaining_seconds !== undefined) {
        remainingSeconds = res.avqr_remaining_seconds;
      }
      startTimer();
      connectSse(currentSessionId);
    });
  } else {
    startTimer();
    connectSse(currentSessionId);
  }

  // Check Server Health
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (res.ok) {
      serverStatusText.textContent = 'سيرفر متصل 🟢';
    }
  } catch (err) {
    serverStatusText.textContent = 'سيرفر محلي ⚠️';
  }

  // Generate New Session
  btnNewSession.addEventListener('click', async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName: 'هندسة البرمجيات (CSE 2026)',
          doctorName: 'د. محمد مطاوع (Matany Group)',
          roomHall: 'مدرج A - FUE',
          autoSaveSeconds: 180
        })
      });
      const data = await res.json();
      if (data.session) {
        currentSessionId = data.session.id;
        sessionIdInput.value = currentSessionId;
        remainingSeconds = 180;
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ avqr_session_id: currentSessionId, avqr_remaining_seconds: 180 });
        }
        connectSse(currentSessionId);
        startTimer();
        alert(`تم توليد جلسة حضور جديدة بنجاح: ${currentSessionId}`);
      }
    } catch (err) {
      console.error(err);
      alert('خطأ في توليد الجلسة، تأكد من تشغيل السيرفر');
    }
  });

  // Open Fullscreen Presenter
  btnOpenPresenter.addEventListener('click', () => {
    const presenterUrl = chrome.runtime.getURL(`presenter.html?sessionId=${encodeURIComponent(sessionIdInput.value)}`);
    chrome.windows.create({
      url: presenterUrl,
      type: 'popup',
      width: 1024,
      height: 768
    });
  });

  // Start Auto Sync in Current Tab
  btnStartAutoSync.addEventListener('click', async () => {
    const activeSessionId = sessionIdInput.value.trim();
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ avqr_session_id: activeSessionId });
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'ACTIVATE_AUTOSYNC',
        sessionId: activeSessionId,
        serverUrl: SERVER_URL
      }, (response) => {
        if (chrome.runtime.lastError) {
          alert('يرجى فتح صفحة جدول الحضور أولاً أو إعادة تحميل الصفحة.');
        } else {
          alert('⚡ تم تفعيل الرصد التلقائي ومطابقة الـ Checkboxes بنجاح!');
        }
      });
    }
  });

  // Force Save Button
  btnForceSave.addEventListener('click', async () => {
    await triggerAutoSave();
  });
});

function startTimer() {
  clearInterval(timerInterval);
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    if (remainingSeconds > 0) {
      remainingSeconds--;
      updateTimerDisplay();
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ avqr_remaining_seconds: remainingSeconds });
      }
    } else {
      clearInterval(timerInterval);
      triggerAutoSave();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timerCountdown = document.getElementById('timerCountdown');
  const progressBar = document.getElementById('progressBar');

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  timerCountdown.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const pct = (remainingSeconds / TOTAL_SECONDS) * 100;
  progressBar.style.width = `${pct}%`;

  if (remainingSeconds < 30) {
    progressBar.style.background = '#FF3366';
  } else if (remainingSeconds < 90) {
    progressBar.style.background = '#FFE600';
  } else {
    progressBar.style.background = '#00F090';
  }
}

async function triggerAutoSave() {
  const sessionIdInput = document.getElementById('sessionIdInput');
  const sid = sessionIdInput.value.trim() || currentSessionId;

  try {
    const res = await fetch(`${SERVER_URL}/api/session/${sid}/auto-save`, { method: 'POST' });
    const data = await res.json();
    console.log('Auto save result:', data);

    // Notify current tab content script to submit the form
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTO_SAVE' });
    }

    alert('💾 تم تنفيذ الحفظ التلقائي بنسبة خطأ 0%!');
  } catch (err) {
    console.error('Auto save error:', err);
  }
}

function connectSse(sessionId) {
  if (sseSource) {
    sseSource.close();
  }

  const livePresentCount = document.getElementById('livePresentCount');
  const studentsLiveList = document.getElementById('studentsLiveList');

  sseSource = new EventSource(`${SERVER_URL}/api/session/${sessionId}/stream`);

  sseSource.addEventListener('STUDENT_ATTENDED', (e) => {
    const student = JSON.parse(e.data);
    addStudentToUI(student);
  });

  sseSource.addEventListener('AUTO_SAVED', (e) => {
    const data = JSON.parse(e.data);
    console.log('Session Auto Saved event received:', data);
  });

  // Also fetch initial list
  fetch(`${SERVER_URL}/api/session/${sessionId}/records`)
    .then(r => r.json())
    .then(records => {
      if (Array.isArray(records)) {
        livePresentCount.textContent = records.length;
        if (records.length > 0) studentsLiveList.innerHTML = '';
        records.forEach(r => addStudentToUI({ studentId: r.student_id, fullName: r.student_name }));
      }
    })
    .catch(() => {});
}

function addStudentToUI(student) {
  const livePresentCount = document.getElementById('livePresentCount');
  const studentsLiveList = document.getElementById('studentsLiveList');

  const emptyNotice = studentsLiveList.querySelector('.empty-notice');
  if (emptyNotice) emptyNotice.remove();

  // Avoid duplicates in list
  if (studentsLiveList.querySelector(`[data-sid="${student.studentId}"]`)) {
    return;
  }

  const li = document.createElement('li');
  li.setAttribute('data-sid', student.studentId);
  li.innerHTML = `
    <span><strong>${student.studentId}</strong>: ${student.fullName}</span>
    <span style="color: #059669;">حاضر ✅</span>
  `;
  studentsLiveList.prepend(li);

  const currentCount = parseInt(livePresentCount.textContent, 10) || 0;
  livePresentCount.textContent = currentCount + 1;
}
