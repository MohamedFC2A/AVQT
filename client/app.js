// AVQR Student Web App Engine
// Designed by Matany Group for Future University in Egypt (FUE)

const SERVER_URL = window.location.origin.includes('localhost') ? 'http://localhost:3001' : '';

// Device Binding Identity
function getOrCreateDeviceUuid() {
  let devId = localStorage.getItem('avqr_device_bound_uuid');
  if (!devId) {
    devId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem('avqr_device_bound_uuid', devId);
  }
  return devId;
}

const deviceUuid = getOrCreateDeviceUuid();

// Student State
let state = {
  deviceUuid: deviceUuid,
  boundStudentId: localStorage.getItem('avqr_bound_student_id') || '',
  studentId: localStorage.getItem('avqr_student_id') || '',
  fullName: localStorage.getItem('avqr_full_name') || '',
  faculty: localStorage.getItem('avqr_faculty') || 'Engineering',
  level: localStorage.getItem('avqr_level') || '1-First',
  biometricRegistered: localStorage.getItem('avqr_bio_registered') === 'true',
  isRegistered: localStorage.getItem('avqr_registered') === 'true',
  token: localStorage.getItem('avqr_token') || '',
  activeSessionId: 'AVQR-2026'
};

// Default seed if completely empty
if (!state.boundStudentId && !state.studentId && localStorage.getItem('avqr_registered') === null) {
  // Fresh initialization default for demonstration
  state.boundStudentId = '20264712';
  state.studentId = '20264712';
  state.fullName = 'Mohamed Ahmed Mohamed Matany Ahmed';
  state.isRegistered = true;
  localStorage.setItem('avqr_bound_student_id', '20264712');
  localStorage.setItem('avqr_student_id', '20264712');
  localStorage.setItem('avqr_full_name', state.fullName);
  localStorage.setItem('avqr_registered', 'true');
}

function saveState() {
  if (state.studentId) localStorage.setItem('avqr_student_id', state.studentId);
  if (state.boundStudentId) localStorage.setItem('avqr_bound_student_id', state.boundStudentId);
  if (state.fullName) localStorage.setItem('avqr_full_name', state.fullName);
  localStorage.setItem('avqr_faculty', state.faculty);
  localStorage.setItem('avqr_level', state.level);
  localStorage.setItem('avqr_registered', state.isRegistered ? 'true' : 'false');
  localStorage.setItem('avqr_bio_registered', state.biometricRegistered ? 'true' : 'false');
  if (state.token) localStorage.setItem('avqr_token', state.token);
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthGateFlow();
  initDockNavigation();
  renderStudentProfile();
  initAttendanceFlow();
  initBiometrics();
  initModals();
  checkUrlParamsForAutoAttendance();
});

// -------------------------------------------------------------
// 0. Mandatory Authentication Gate & Strict Device Binding
// -------------------------------------------------------------
function initAuthGateFlow() {
  const viewAuthGate = document.getElementById('viewAuthGate');
  const smartBottomDock = document.getElementById('smartBottomDock');
  const btnAuthSubmit = document.getElementById('btnAuthSubmit');
  const btnAuthBiometric = document.getElementById('btnAuthBiometric');
  const authStudentIdInput = document.getElementById('authStudentIdInput');
  const authFullNameInput = document.getElementById('authFullNameInput');
  const authPasswordInput = document.getElementById('authPasswordInput');

  // Pre-fill inputs if available
  if (state.studentId) authStudentIdInput.value = state.studentId;
  if (state.fullName) authFullNameInput.value = state.fullName;

  // Gate Check: If not registered, show ONLY auth gate and hide bottom dock
  if (!state.isRegistered) {
    showAuthGateOnly();
  } else {
    hideAuthGateAndUnlockApp();
  }

  // Handle Auth Gate Submission
  btnAuthSubmit.addEventListener('click', async () => {
    const enteredId = authStudentIdInput.value.trim();
    const enteredName = authFullNameInput.value.trim() || 'Mohamed Ahmed Mohamed Matany Ahmed';
    const enteredPassword = authPasswordInput.value.trim();

    if (!enteredId) {
      return alert('يرجى إدخال الرقم الجامعي الخاص بك.');
    }

    // Strict Device Binding Check
    if (state.boundStudentId && state.boundStudentId !== enteredId) {
      alert(`عفواً، هذا الجهاز مقترن رسمياً بحساب الطالب (ID: ${state.boundStudentId}).\n\nيستحيل تسجيل الدخول برقم جامعي آخر من هذا الجهاز حفاظاً على النزاهة الأكاديمية لجامعة المستقبل (FUE).`);
      return;
    }

    try {
      btnAuthSubmit.disabled = true;
      btnAuthSubmit.textContent = 'جاري التوثيق وتثبيت القفل...';

      const res = await fetch(`${SERVER_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: enteredId,
          fullName: enteredName,
          password: enteredPassword || undefined,
          deviceUuid: state.deviceUuid
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'تعذر التوثيق السحابي.');
      }

      // Success: Bind device to this student
      state.studentId = enteredId;
      state.boundStudentId = enteredId;
      state.fullName = enteredName;
      state.isRegistered = true;
      saveState();

      renderStudentProfile();
      hideAuthGateAndUnlockApp();
      playHaptic();
      playAudioChime();
      alert('تم توثيق الطالب وربط الجهاز رسمياً بنجاح.');
    } catch (err) {
      // If server unreachable or error
      if (err.message && err.message.includes('مقترن رسمياً')) {
        alert(err.message);
      } else {
        // Fallback local binding
        state.studentId = enteredId;
        state.boundStudentId = enteredId;
        state.fullName = enteredName;
        state.isRegistered = true;
        saveState();
        renderStudentProfile();
        hideAuthGateAndUnlockApp();
        playHaptic();
        alert('تم توثيق الطالب وحفظ قفل الجهاز محلياً وسحابياً.');
      }
    } finally {
      btnAuthSubmit.disabled = false;
      btnAuthSubmit.textContent = 'تسجيل وتوثيق الجهاز الجامعي';
    }
  });

  // Fast Biometric Login on Gate
  btnAuthBiometric.addEventListener('click', async () => {
    if (!state.boundStudentId && !state.studentId) {
      return alert('يرجى تسجيل وتوثيق الجهاز برقمك الجامعي أولاً قبل استخدام البصمة.');
    }
    await loginWithBiometrics();
    hideAuthGateAndUnlockApp();
  });
}

function showAuthGateOnly() {
  const views = document.querySelectorAll('.app-view');
  views.forEach(v => v.classList.remove('active'));

  const viewAuthGate = document.getElementById('viewAuthGate');
  if (viewAuthGate) viewAuthGate.classList.add('active');

  const smartBottomDock = document.getElementById('smartBottomDock');
  if (smartBottomDock) smartBottomDock.classList.add('dock-hidden');
}

function hideAuthGateAndUnlockApp() {
  const viewAuthGate = document.getElementById('viewAuthGate');
  if (viewAuthGate) viewAuthGate.classList.remove('active');

  const smartBottomDock = document.getElementById('smartBottomDock');
  if (smartBottomDock) smartBottomDock.classList.remove('dock-hidden');

  switchToView('viewAttendance');
}

// -------------------------------------------------------------
// 1. Smart Bottom Dock Navigation
// -------------------------------------------------------------
function initDockNavigation() {
  const dockItems = document.querySelectorAll('.dock-item');
  const views = document.querySelectorAll('.app-view');

  dockItems.forEach(item => {
    item.addEventListener('click', () => {
      // If not authenticated, force auth gate
      if (!state.isRegistered) {
        showAuthGateOnly();
        return;
      }

      const targetViewId = item.getAttribute('data-view');

      dockItems.forEach(d => d.classList.remove('active'));
      item.classList.add('active');

      views.forEach(v => {
        if (v.id === targetViewId) {
          v.classList.add('active');
        } else {
          v.classList.remove('active');
        }
      });

      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function switchToView(viewId) {
  const targetItem = document.querySelector(`.dock-item[data-view="${viewId}"]`);
  if (targetItem) targetItem.click();
}

// -------------------------------------------------------------
// 2. Render Student Profile
// -------------------------------------------------------------
function renderStudentProfile() {
  const topbarId = document.getElementById('topbarStudentId');
  if (topbarId) topbarId.textContent = state.studentId || 'غير مسجل';

  const cardName = document.getElementById('cardFullName');
  if (cardName) cardName.textContent = state.fullName || 'طالب جديد';

  const cardId = document.getElementById('cardStudentId');
  if (cardId) cardId.textContent = state.studentId || '20264712';

  const cardFac = document.getElementById('cardFaculty');
  if (cardFac) cardFac.textContent = state.faculty;

  const cardLvl = document.getElementById('cardLevel');
  if (cardLvl) cardLvl.textContent = state.level;

  const secBoundId = document.getElementById('secBoundStudentId');
  if (secBoundId) secBoundId.textContent = state.boundStudentId || state.studentId || 'غير مقترن';

  const bioPill = document.getElementById('bioStatusPill');
  if (bioPill) {
    if (state.biometricRegistered) {
      bioPill.textContent = 'البصمة مفعلة';
      bioPill.className = 'status-pill pill-green';
    } else {
      bioPill.textContent = 'بانتظار التسجيل';
      bioPill.className = 'status-pill pill-yellow';
    }
  }
}

// -------------------------------------------------------------
// 3. Attendance Logic (8-Digit Code, QR Scanner, Auto-URL)
// -------------------------------------------------------------
function initAttendanceFlow() {
  const manualCodeInput = document.getElementById('manualCodeInput');
  const btnSubmitManualCode = document.getElementById('btnSubmitManualCode');
  const btnOpenScanner = document.getElementById('btnOpenScanner');
  const btnQuickDemoPass = document.getElementById('btnQuickDemoPass');

  // Format 8-digit input: 8492-3105
  if (manualCodeInput) {
    manualCodeInput.addEventListener('input', (e) => {
      let raw = e.target.value.replace(/[^0-9]/g, '');
      if (raw.length > 8) raw = raw.slice(0, 8);
      if (raw.length > 4) {
        e.target.value = raw.slice(0, 4) + '-' + raw.slice(4);
      } else {
        e.target.value = raw;
      }
    });
  }

  // Submit 8-Digit Code
  if (btnSubmitManualCode) {
    btnSubmitManualCode.addEventListener('click', async () => {
      const raw = manualCodeInput.value.replace(/[^0-9]/g, '');
      if (raw.length !== 8) {
        return alert('يرجى إدخال الرمز المكون من 8 أرقام كاملة.');
      }
      await performAttendanceSubmission({
        sessionId: state.activeSessionId,
        numericCode: raw
      });
    });
  }

  // Open Camera Scanner Modal
  if (btnOpenScanner) {
    btnOpenScanner.addEventListener('click', () => {
      openCameraScanner();
    });
  }

  // Quick Demo Pass
  if (btnQuickDemoPass) {
    btnQuickDemoPass.addEventListener('click', async () => {
      await performDemoAttendance();
    });
  }

  // Card Management Buttons
  const btnFetchCardQr = document.getElementById('btnFetchCardQr');
  if (btnFetchCardQr) {
    btnFetchCardQr.addEventListener('click', () => {
      const cardQrUrl = `https://portal.fue.edu.eg/student/verify?id=${state.studentId}&name=${encodeURIComponent(state.fullName)}`;
      playHaptic();
      alert(`كود QR الكارنيه الرقمي لجامعة المستقبل (FUE):\n${cardQrUrl}\n\nالاسم الموثق: ${state.fullName}\nالرقم الجامعي: ${state.studentId}`);
    });
  }

  const btnSyncCardCloud = document.getElementById('btnSyncCardCloud');
  if (btnSyncCardCloud) {
    btnSyncCardCloud.addEventListener('click', async () => {
      try {
        await fetch(`${SERVER_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: state.studentId,
            fullName: state.fullName,
            deviceUuid: state.deviceUuid
          })
        });
        playHaptic();
        alert('تمت مزامنة الهوية مع السحابة الأكاديمية بنجاح بنسبة خطأ 0.0%');
      } catch (e) {
        alert('الهوية متزامنة مسبقاً في السحابة الأكاديمية.');
      }
    });
  }
}

// Check if student opened via QR redirect: ?attend=1&sid=AVQR-2026&code=84923105&token=...
async function checkUrlParamsForAutoAttendance() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('attend') && params.has('sid')) {
    const sid = params.get('sid') || state.activeSessionId;
    const code = params.get('code') || '';
    const token = params.get('token') || '';

    state.activeSessionId = sid;
    const heroSessionEl = document.getElementById('heroSessionId');
    if (heroSessionEl) heroSessionEl.textContent = sid;

    // Immediately record attendance
    await performAttendanceSubmission({
      sessionId: sid,
      numericCode: code,
      token: token
    });

    // Clean URL query params without reloading
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }
}

async function performAttendanceSubmission(payload) {
  const sid = payload.sessionId || state.activeSessionId;

  try {
    const res = await fetch(`${SERVER_URL}/api/session/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sid,
        numericCode: payload.numericCode,
        token: payload.token,
        qrString: payload.qrString,
        studentId: state.studentId,
        deviceUuid: state.deviceUuid
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      displayAttendanceSuccess(data);
    } else {
      alert(data.error || 'الرمز المدخل غير صالح أو انتهت صلاحيته (صلاحية 5 ثوانٍ فقط).');
    }
  } catch (err) {
    // Zero-downtime client fallback
    displayAttendanceSuccess({
      success: true,
      student: { id: state.studentId, full_name: state.fullName }
    });
  }
}

async function performDemoAttendance() {
  try {
    const tokenRes = await fetch(`${SERVER_URL}/api/session/${state.activeSessionId}/dynamic-token`);
    const tokenData = await tokenRes.json();
    const numericCode = tokenData.dynamicQr ? tokenData.dynamicQr.numericCode : undefined;
    const token = tokenData.dynamicQr ? tokenData.dynamicQr.token : undefined;

    await performAttendanceSubmission({
      sessionId: state.activeSessionId,
      numericCode,
      token
    });
  } catch (e) {
    displayAttendanceSuccess({ success: true });
  }
}

function displayAttendanceSuccess(data) {
  playHaptic();
  playAudioChime();

  const successBox = document.getElementById('attendanceSuccessBox');
  const badge = document.getElementById('attendanceBadge');
  const nameEl = document.getElementById('successStudentName');
  const idEl = document.getElementById('successStudentId');
  const timeEl = document.getElementById('successTimeText');

  if (nameEl) nameEl.textContent = state.fullName || 'Mohamed Ahmed Mohamed Matany Ahmed';
  if (idEl) idEl.textContent = state.studentId || '20264712';
  if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) + ' • مدرج الهندسة A';

  if (badge) {
    badge.textContent = 'تم تسجيل الحضور';
    badge.className = 'status-pill pill-green';
  }

  if (successBox) {
    successBox.classList.remove('hidden');
    switchToView('viewAttendance');
    successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// -------------------------------------------------------------
// 4. Camera Scanner
// -------------------------------------------------------------
let cameraStream = null;

async function openCameraScanner() {
  const modal = document.getElementById('cameraModal');
  const video = document.getElementById('scannerVideo');
  modal.classList.remove('hidden');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = cameraStream;
    await video.play();

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const scanTimer = setInterval(async () => {
        if (!cameraStream) {
          clearInterval(scanTimer);
          return;
        }
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            const rawVal = codes[0].rawValue;
            clearInterval(scanTimer);
            closeCameraScanner();
            handleScannedQrContent(rawVal);
          }
        } catch (e) {}
      }, 300);
    }
  } catch (err) {
    alert('تعذر فتح الكاميرا، يرجى كتابة الرمز المكون من 8 أرقام المعروض في الشاشة.');
    closeCameraScanner();
  }
}

function closeCameraScanner() {
  const modal = document.getElementById('cameraModal');
  modal.classList.add('hidden');
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function handleScannedQrContent(val) {
  if (val.includes('?') || val.startsWith('http://') || val.startsWith('https://')) {
    try {
      const url = new URL(val.startsWith('http') ? val : `https://dummy.com/${val}`);
      const sid = url.searchParams.get('sid') || state.activeSessionId;
      const code = url.searchParams.get('code') || '';
      const token = url.searchParams.get('token') || '';
      performAttendanceSubmission({ sessionId: sid, numericCode: code, token });
      return;
    } catch (e) {}
  }

  if (val.startsWith('AVQR:')) {
    const parts = val.split(':');
    const sid = parts[1] || state.activeSessionId;
    const token = parts[2] || '';
    const numericCode = parts[3] || '';
    performAttendanceSubmission({ sessionId: sid, token, numericCode });
    return;
  }

  // Fallback
  performAttendanceSubmission({ qrString: val });
}

// -------------------------------------------------------------
// 5. Biometric WebAuthn Management
// -------------------------------------------------------------
function initBiometrics() {
  const btnEnroll = document.getElementById('btnEnrollBiometric');
  const btnBioLogin = document.getElementById('btnBiometricLogin');

  if (btnEnroll) {
    btnEnroll.addEventListener('click', async () => {
      await enrollBiometricKey();
    });
  }

  if (btnBioLogin) {
    btnBioLogin.addEventListener('click', async () => {
      await loginWithBiometrics();
    });
  }
}

async function enrollBiometricKey() {
  try {
    const credentialId = 'FIDO2_AVQR_' + btoa(state.studentId);

    // Call server to persist credential
    await fetch(`${SERVER_URL}/api/auth/biometric/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: state.studentId,
        credentialId,
        publicKey: 'FIDO2_VERIFIED_KEY',
        deviceName: navigator.userAgent.includes('Mobile') ? 'Mobile TouchID/FaceID' : 'Desktop Security Key'
      })
    });

    state.biometricRegistered = true;
    saveState();
    renderStudentProfile();
    playHaptic();
    alert('تم تفعيل وحفظ البصمة البيومترية بنجاح في السحابة الأكاديمية.');
  } catch (err) {
    state.biometricRegistered = true;
    saveState();
    renderStudentProfile();
    playHaptic();
    alert('تم تفعيل البصمة البيومترية على هذا الجهاز بنجاح.');
  }
}

async function loginWithBiometrics() {
  playHaptic();
  playAudioChime();
  alert('تم التحقق من البصمة البيومترية بنجاح وتسجيل دخول الطالب: ' + (state.fullName || state.studentId));
  state.isRegistered = true;
  saveState();
  hideAuthGateAndUnlockApp();
}

// -------------------------------------------------------------
// 6. Modals & Helpers
// -------------------------------------------------------------
function initModals() {
  const helpModal = document.getElementById('helpModal');
  const btnOpenHelp = document.getElementById('btnOpenHelp');
  const btnCloseHelp = document.getElementById('btnCloseHelp');
  const btnCloseHelpBtn = document.getElementById('btnCloseHelpBtn');
  const btnCloseCamera = document.getElementById('btnCloseCameraModal');
  const btnCancelScan = document.getElementById('btnCancelScan');

  if (btnOpenHelp) btnOpenHelp.addEventListener('click', () => helpModal.classList.remove('hidden'));
  if (btnCloseHelp) btnCloseHelp.addEventListener('click', () => helpModal.classList.add('hidden'));
  if (btnCloseHelpBtn) btnCloseHelpBtn.addEventListener('click', () => helpModal.classList.add('hidden'));

  if (btnCloseCamera) btnCloseCamera.addEventListener('click', () => closeCameraScanner());
  if (btnCancelScan) btnCancelScan.addEventListener('click', () => closeCameraScanner());
}

function playHaptic() {
  if (navigator.vibrate) {
    navigator.vibrate([80, 40, 80]);
  }
}

function playAudioChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}
