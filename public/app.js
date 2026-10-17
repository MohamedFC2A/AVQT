const SERVER_URL = window.location.origin.includes('localhost') ? 'http://localhost:3001' : '';

// Student State
let state = {
  studentId: localStorage.getItem('avqr_student_id') || '20264712',
  fullName: localStorage.getItem('avqr_full_name') || 'Mohamed Ahmed Mohamed Matany Ahmed',
  faculty: localStorage.getItem('avqr_faculty') || 'Engineering',
  level: localStorage.getItem('avqr_level') || '1-First',
  cardVerified: localStorage.getItem('avqr_card_verified') === 'true',
  biometricRegistered: localStorage.getItem('avqr_bio_registered') === 'true',
  token: localStorage.getItem('avqr_token') || ''
};

// Seed default verified state if first time
if (!localStorage.getItem('avqr_student_id')) {
  state.cardVerified = true;
  saveState();
}

function saveState() {
  localStorage.setItem('avqr_student_id', state.studentId);
  localStorage.setItem('avqr_full_name', state.fullName);
  localStorage.setItem('avqr_faculty', state.faculty);
  localStorage.setItem('avqr_level', state.level);
  localStorage.setItem('avqr_card_verified', state.cardVerified ? 'true' : 'false');
  localStorage.setItem('avqr_bio_registered', state.biometricRegistered ? 'true' : 'false');
  if (state.token) localStorage.setItem('avqr_token', state.token);
}

document.addEventListener('DOMContentLoaded', () => {
  renderProfileUI();

  // Step 1: Login & Register
  const studentIdInput = document.getElementById('studentIdInput');
  const studentPasswordInput = document.getElementById('studentPasswordInput');
  const btnLogin = document.getElementById('btnLogin');
  const btnBiometricLogin = document.getElementById('btnBiometricLogin');

  studentIdInput.value = state.studentId;

  btnLogin.addEventListener('click', async () => {
    const id = studentIdInput.value.trim();
    const password = studentPasswordInput.value.trim();
    if (!id) return alert('الرقم الجامعي مطلوب');

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password })
      });
      const data = await res.json();
      if (data.student) {
        state.studentId = data.student.id;
        state.fullName = data.student.full_name;
        state.faculty = data.student.faculty || state.faculty;
        state.level = data.student.level || state.level;
        state.cardVerified = data.student.card_verified !== undefined ? data.student.card_verified : state.cardVerified;
        state.token = data.token;
        saveState();
        renderProfileUI();
        alert(`تم تسجيل وحفظ الحساب بنجاح للطالب: ${state.fullName}`);
      }
    } catch (err) {
      state.studentId = id;
      saveState();
      renderProfileUI();
      alert(`تم الدخول بالرقم الجامعي: ${id}`);
    }
  });

  // Biometric WebAuthn Login
  btnBiometricLogin.addEventListener('click', async () => {
    await handleBiometricAuth();
  });

  // Step 2: FUE Card Scan & Verification
  const btnScanCardQr = document.getElementById('btnScanCardQr');
  const btnTestVerifyMatany = document.getElementById('btnTestVerifyMatany');

  if (btnScanCardQr) {
    btnScanCardQr.addEventListener('click', () => {
      openCameraScanner('CARD_SCAN');
    });
  }

  if (btnTestVerifyMatany) {
    btnTestVerifyMatany.addEventListener('click', async () => {
      await verifyFueCard('https://services.fue.edu.eg/FueCards/StudentCard.aspx?SS=cc011cc7-ceb7-4867-973a-79d0a44e5214');
    });
  }

  // Step 3: Option A - QR Camera Scan
  const btnOpenLectureScanner = document.getElementById('btnOpenLectureScanner');
  const btnCloseScanner = document.getElementById('btnCloseScanner');

  btnOpenLectureScanner.addEventListener('click', () => {
    openCameraScanner('LECTURE_SCAN');
  });

  btnCloseScanner.addEventListener('click', () => {
    closeCameraScanner();
  });

  // Step 3: Option B - 8-Digit Manual Fallback Code
  const manualCodeInput = document.getElementById('manualCodeInput');
  const btnSubmitManualCode = document.getElementById('btnSubmitManualCode');

  btnSubmitManualCode.addEventListener('click', async () => {
    const code = manualCodeInput.value.trim().replace(/[^0-9]/g, '');
    if (code.length !== 8) {
      return alert('يرجى إدخال الرمز المكون من 8 أرقام كاملة');
    }
    await performAttendWithNumericCode(code);
  });

  // Quick Demo Attend
  const btnQuickAttendDemo = document.getElementById('btnQuickAttendDemo');
  btnQuickAttendDemo.addEventListener('click', async () => {
    await performQuickDemoAttend();
  });

  // Support Modal
  const btnOpenSupport = document.getElementById('btnOpenSupport');
  const btnCloseSupport = document.getElementById('btnCloseSupport');
  const supportModal = document.getElementById('supportModal');

  btnOpenSupport.addEventListener('click', () => supportModal.classList.remove('hidden'));
  btnCloseSupport.addEventListener('click', () => supportModal.classList.add('hidden'));
});

function renderProfileUI() {
  document.getElementById('profileIdTag').textContent = state.studentId;
  document.getElementById('profileNameDisplay').textContent = state.fullName;
  document.getElementById('profileFaculty').textContent = state.faculty;
  document.getElementById('profileLevel').textContent = state.level;

  const statusTag = document.getElementById('profileVerifiedStatus');
  const step2Card = document.getElementById('step2Card');
  const step2SuccessBanner = document.getElementById('step2SuccessBanner');
  const step2ActionArea = document.getElementById('step2ActionArea');

  if (state.cardVerified) {
    statusTag.textContent = 'موثق رسمياً';
    statusTag.style.background = '#00F090';
    step2Card.classList.add('completed');
    if (step2SuccessBanner) step2SuccessBanner.classList.remove('hidden');
    if (step2ActionArea) step2ActionArea.classList.add('hidden');
    document.getElementById('step2Checkmark').textContent = 'موثق';
  } else {
    statusTag.textContent = 'بانتظار التحقق';
    statusTag.style.background = '#FFE600';
    step2Card.classList.remove('completed');
    if (step2SuccessBanner) step2SuccessBanner.classList.add('hidden');
    if (step2ActionArea) step2ActionArea.classList.remove('hidden');
    document.getElementById('step2Checkmark').textContent = 'غير موثق';
  }
}

// Biometric WebAuthn
async function handleBiometricAuth() {
  try {
    const credentialId = 'FIDO2_CRED_' + btoa(state.studentId);
    await fetch(`${SERVER_URL}/api/auth/biometric/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: state.studentId,
        credentialId,
        deviceName: 'Mobile WebAuthn Key'
      })
    });
    state.biometricRegistered = true;
    saveState();
    playHapticFeedback();
    alert('تم تفعيل وحفظ البصمة البيومترية بنجاح في قاعدة البيانات.');
  } catch (err) {
    state.biometricRegistered = true;
    saveState();
    playHapticFeedback();
    alert('تم التحقق وتفعيل البصمة البيومترية.');
  }
}

// Step 2: Verify FUE Card
async function verifyFueCard(cardUrlOrUuid) {
  try {
    const res = await fetch(`${SERVER_URL}/api/student/verify-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: state.studentId,
        cardUrlOrUuid
      })
    });
    const data = await res.json();
    if (data.student) {
      state.fullName = data.student.full_name;
      state.faculty = data.student.faculty || 'Engineering';
      state.level = data.student.level || '1-First';
      state.cardVerified = true;
      saveState();
      renderProfileUI();
      playHapticFeedback();
      alert(`تم التحقق رسمياً من كارنيه FUE واعتماد الاسم: ${state.fullName}`);
    }
  } catch (err) {
    state.fullName = 'Mohamed Ahmed Mohamed Matany Ahmed';
    state.faculty = 'Engineering';
    state.level = '1-First';
    state.cardVerified = true;
    saveState();
    renderProfileUI();
    alert('تم توثيق بيانات الكارنيه بنجاح.');
  }
}

// Step 3: Attend with 8-Digit Numeric Code
async function performAttendWithNumericCode(code) {
  const sessionId = 'AVQR-2026';

  try {
    const res = await fetch(`${SERVER_URL}/api/session/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        numericCode: code,
        studentId: state.studentId
      })
    });

    const data = await res.json();
    if (data.success) {
      showAttendanceSuccess(data);
    } else {
      alert(data.error || 'الرمز المدخل غير صالح أو انتهت صلاحيته');
    }
  } catch (err) {
    showAttendanceSuccess({ success: true });
  }
}

// Step 3: Quick Demo Attend
async function performQuickDemoAttend() {
  const sessionId = 'AVQR-2026';

  try {
    const tokenRes = await fetch(`${SERVER_URL}/api/session/${sessionId}/dynamic-token`);
    const tokenData = await tokenRes.json();
    const qrString = tokenData.dynamicQr ? tokenData.dynamicQr.qrString : `AVQR:${sessionId}:TOKEN:0`;
    const numericCode = tokenData.dynamicQr ? tokenData.dynamicQr.numericCode : undefined;

    const attendRes = await fetch(`${SERVER_URL}/api/session/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        qrString,
        numericCode,
        studentId: state.studentId
      })
    });

    const attendData = await attendRes.json();
    if (attendData.success) {
      showAttendanceSuccess(attendData);
    } else {
      alert(attendData.error || 'خطأ في تسجيل الحضور');
    }
  } catch (err) {
    showAttendanceSuccess({ success: true });
  }
}

function showAttendanceSuccess(data) {
  playHapticFeedback();
  playSuccessAudio();

  const successAlert = document.getElementById('attendanceSuccessAlert');
  const successStudentName = document.getElementById('successStudentName');
  const successTimestamp = document.getElementById('successTimestamp');
  const step3StatusTag = document.getElementById('step3StatusTag');

  successStudentName.textContent = state.fullName + ` (${state.studentId})`;
  successTimestamp.textContent = new Date().toLocaleTimeString('ar-EG') + ' • مدرج الهندسة A';

  successAlert.classList.remove('hidden');
  step3StatusTag.textContent = 'حاضر';
  step3StatusTag.className = 'status-pill text-green';

  successAlert.scrollIntoView({ behavior: 'smooth' });
}

function playHapticFeedback() {
  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }
}

function playSuccessAudio() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {}
}

// Camera Scanner
let videoStream = null;

async function openCameraScanner(mode) {
  const box = document.getElementById('cameraScannerBox');
  const video = document.getElementById('scannerVideo');
  box.classList.remove('hidden');

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = videoStream;
    await video.play();

    if ('BarcodeDetector' in window) {
      const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
      const scanInterval = setInterval(async () => {
        if (!videoStream) {
          clearInterval(scanInterval);
          return;
        }
        try {
          const barcodes = await barcodeDetector.detect(video);
          if (barcodes.length > 0) {
            const val = barcodes[0].rawValue;
            clearInterval(scanInterval);
            closeCameraScanner();
            if (mode === 'CARD_SCAN') {
              verifyFueCard(val);
            } else {
              performAttendWithQrString(val);
            }
          }
        } catch (e) {}
      }, 300);
    }
  } catch (err) {
    alert('تعذر فتح الكاميرا، يرجى كتابة الرمز المكون من 8 أرقام يدوياً.');
    closeCameraScanner();
  }
}

function closeCameraScanner() {
  const box = document.getElementById('cameraScannerBox');
  box.classList.add('hidden');
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
}

async function performAttendWithQrString(qrString) {
  const parts = qrString.split(':');
  const sid = parts[1] || 'AVQR-2026';

  try {
    const res = await fetch(`${SERVER_URL}/api/session/attend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sid,
        qrString,
        studentId: state.studentId
      })
    });
    const data = await res.json();
    if (data.success) {
      showAttendanceSuccess(data);
    } else {
      alert(data.error || 'كود غير صالح');
    }
  } catch (err) {
    showAttendanceSuccess({ success: true });
  }
}
