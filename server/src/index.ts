import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, initDb } from './db.js';
import { fetchFueStudentCard } from './services/fueCardScraper.js';
import { generateDynamicQrToken, verifyDynamicQrToken, verifyDynamicNumericCode, verifyDynamicTokenDetailed } from './services/dynamicQrService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'MATANY_GROUP_AVQR_JWT_SUPER_SECRET';

app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve Student Web App & Mock Portal
const clientPath = path.resolve(__dirname, '../../client');
const mockPortalPath = path.resolve(__dirname, '../../mock-fue-portal');
const extensionPath = path.resolve(__dirname, '../../extension');

app.use(express.static(clientPath));
app.use('/portal', express.static(mockPortalPath));
app.use('/ext', express.static(extensionPath));

// In-Memory SSE Client Connections mapped by sessionId
const sseClients = new Map<string, Set<Response>>();

function broadcastToSession(sessionId: string, event: string, data: any) {
  const clients = sseClients.get(sessionId);
  if (clients && clients.size > 0) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }
}

// -------------------------------------------------------------
// 1. Student Authentication & Registration (Step 1)
// -------------------------------------------------------------

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { id, password, fullName, deviceUuid } = req.body;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'الرقم الجامعي مطلوب (مثال: 20264712)' });
    }

    const cleanId = id.trim();

    // Strict Device Lock: verify device is not bound to another student
    if (deviceUuid) {
      const boundStudent = await db.getStudentByDevice(deviceUuid);
      if (boundStudent && boundStudent.id !== cleanId) {
        return res.status(403).json({
          error: `عفواً، هذا الجهاز مقترن رسمياً بحساب الطالب (${boundStudent.id}). يستحيل تسجيل الدخول برقم جامعي آخر من هذا الجهاز حفاظاً على النزاهة الأكاديمية.`
        });
      }
    }

    let passwordHash: string | undefined;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const student = await db.upsertStudent({
      id: cleanId,
      full_name: fullName || `طالب ${cleanId}`,
      password_hash: passwordHash,
      device_uuid: deviceUuid
    });

    const token = jwt.sign({ id: student.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'تم تسجيل الحساب وتوثيق الجهاز الجامعي بنجاح',
      student,
      token
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'خطأ في الخادم' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { id, password, deviceUuid } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'الرقم الجامعي مطلوب' });
    }

    const cleanId = id.trim();

    // Strict Device Lock
    if (deviceUuid) {
      const boundStudent = await db.getStudentByDevice(deviceUuid);
      if (boundStudent && boundStudent.id !== cleanId) {
        return res.status(403).json({
          error: `عفواً، هذا الجهاز مقترن رسمياً بحساب الطالب (${boundStudent.id}). يستحيل تسجيل الدخول برقم جامعي آخر من هذا الجهاز حفاظاً على النزاهة الأكاديمية.`
        });
      }
    }

    let student = await db.getStudent(cleanId);

    if (!student) {
      // Auto-register convenience for student flow
      student = await db.upsertStudent({ id: cleanId, device_uuid: deviceUuid });
    } else {
      if (deviceUuid && !student.device_uuid) {
        student = await db.upsertStudent({ id: cleanId, device_uuid: deviceUuid });
      }
      if (password && student.password_hash) {
        const match = await bcrypt.compare(password, student.password_hash);
        if (!match) {
          return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
        }
      }
    }

    const token = jwt.sign({ id: student.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'تم تسجيل الدخول وتوثيق الجهاز بنجاح',
      student,
      token
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'خطأ في الخادم' });
  }
});

// Biometric WebAuthn Mock / Registration API
app.post('/api/auth/biometric/register', async (req: Request, res: Response) => {
  try {
    const { studentId, credentialId, publicKey, deviceName } = req.body;
    if (!studentId || !credentialId) {
      return res.status(400).json({ error: 'بيانات البصمة غير مكتملة' });
    }

    await db.saveCredential({
      id: credentialId,
      student_id: studentId,
      public_key: publicKey || 'FIDO2_SECURE_PUBLIC_KEY',
      counter: 1,
      device_name: deviceName || 'Mobile Biometric Key',
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'تم تفعيل واعتماد البصمة البيومترية بالسحابة الأكاديمية بنجاح'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/biometric/login', async (req: Request, res: Response) => {
  try {
    const { studentId, credentialId } = req.body;
    let student = await db.getStudent(studentId);
    if (!student) {
      return res.status(404).json({ error: 'الطالب غير موجود' });
    }

    const cred = await db.getCredential(credentialId);
    if (cred && cred.student_id !== studentId) {
      return res.status(401).json({ error: 'البصمة غير مطابقة لهذا الحساب' });
    }

    const token = jwt.sign({ id: student.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true,
      message: 'تم تسجيل الدخول بالبصمة البيومترية بنجاح',
      student,
      token
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 2. FUE ID Card QR Code Verification (Step 2 - One Time Only)
// -------------------------------------------------------------

app.post('/api/student/verify-card', async (req: Request, res: Response) => {
  try {
    const { studentId, cardUrlOrUuid, deviceUuid } = req.body;
    if (!studentId && !cardUrlOrUuid) {
      return res.status(400).json({ error: 'رابط أو كود الكارنيه مطلوب' });
    }

    const effectiveSource = cardUrlOrUuid || 'cc011cc7-ceb7-4867-973a-79d0a44e5214';
    console.log(`[FUE Card Verification] Fetching card with source: ${effectiveSource}`);
    const cardData = await fetchFueStudentCard(effectiveSource);
    const targetStudentId = studentId || cardData.code;
    if (!targetStudentId) {
      return res.status(400).json({ error: 'تعذر استخراج رقم الطالب من الكارنيه' });
    }

    // Strict 1:1 Device Binding Verification
    const existingStudent = await db.getStudent(targetStudentId);
    if (existingStudent && existingStudent.device_uuid && deviceUuid && existingStudent.device_uuid !== deviceUuid) {
      // Conflict: Attempting to register on another phone
      let transfer = await db.getPendingTransferRequest(targetStudentId);
      if (!transfer || transfer.to_device_uuid !== deviceUuid) {
        transfer = await db.createDeviceTransferRequest(
          targetStudentId,
          existingStudent.device_uuid,
          deviceUuid,
          req.body.deviceName || 'هاتف محمول جديد'
        );
      }
      return res.status(403).json({
        error: 'DEVICE_LOCKED',
        message: 'هذا الكارنيه مقترن بهاتف آخر. تم إرسال طلب انتقال ذكي إلى الهاتف المعتمد للموافقة بالبصمة.',
        studentId: targetStudentId,
        transferId: transfer.id,
        fromDeviceUuid: existingStudent.device_uuid
      });
    }

    // Verify code match or update student record
    const updated = await db.upsertStudent({
      id: targetStudentId,
      full_name: cardData.fullName || `طالب ${targetStudentId}`,
      faculty: cardData.faculty || 'Engineering',
      level: cardData.level || '1-First',
      photo_url: cardData.photoUrl,
      card_verified: true,
      card_ss_uuid: cardData.ssUuid,
      card_verified_at: new Date().toISOString(),
      device_uuid: deviceUuid || existingStudent?.device_uuid
    });

    res.json({
      success: true,
      message: 'تم التحقق من كارنيه جامعة المستقبل (FUE) واعتماد الاسم الرسمي للأبد بنجاح',
      student: updated,
      cardData
    });
  } catch (error: any) {
    console.error('Card verification error:', error);
    res.status(500).json({ error: 'تعذر التحقق من كود الكارنيه: ' + (error.message || '') });
  }
});

app.get('/api/student/profile/:id', async (req: Request, res: Response) => {
  try {
    const student = await db.getStudent(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'الطالب غير موجود' });
    }
    res.json({ student });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 2.1 Biometric Sovereign Device Transfer Endpoints
// -------------------------------------------------------------
app.get('/api/device-transfer/pending/:studentId', async (req: Request, res: Response) => {
  try {
    const transfer = await db.getPendingTransferRequest(req.params.studentId);
    res.json({ transfer });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/device-transfer/status/:requestId', async (req: Request, res: Response) => {
  try {
    const transfer = await db.getTransferRequest(req.params.requestId);
    if (!transfer) return res.status(404).json({ error: 'طلب النقل غير موجود' });
    let student = null;
    if (transfer.status === 'APPROVED') {
      student = await db.getStudent(transfer.student_id);
    }
    res.json({ transfer, student });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/device-transfer/approve', async (req: Request, res: Response) => {
  try {
    const { requestId, authorizingDeviceUuid } = req.body;
    const transfer = await db.getTransferRequest(requestId);
    if (!transfer) return res.status(404).json({ error: 'طلب النقل غير موجود' });
    if (transfer.status !== 'PENDING') return res.status(400).json({ error: 'تم البت في هذا الطلب مسبقاً' });

    if (authorizingDeviceUuid && transfer.from_device_uuid && transfer.from_device_uuid !== authorizingDeviceUuid) {
      return res.status(403).json({ error: 'غير مصرح: يجب الموافقة من الجهاز الأصلي المعتمد حصراً' });
    }

    const resolved = await db.resolveTransferRequest(requestId, 'APPROVED');
    res.json({ success: true, message: 'تم اعتماد نقل الحساب إلى الجهاز الجديد بنجاح', transfer: resolved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/device-transfer/reject', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.body;
    const resolved = await db.resolveTransferRequest(requestId, 'REJECTED');
    res.json({ success: true, message: 'تم رفض طلب نقل الحساب بنجاح', transfer: resolved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// 3. Attendance Sessions & Dynamic Rotating QR (Step 3)
// -------------------------------------------------------------

app.post('/api/session/create', async (req: Request, res: Response) => {
  try {
    const { courseName, doctorName, roomHall, autoSaveSeconds } = req.body;
    const sessionId = 'AVQR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const dynamicPayload = generateDynamicQrToken(sessionId);

    const session = await db.createSession({
      id: sessionId,
      course_name: courseName || 'مقدمة في هندسة البرمجيات (CSE 2026)',
      doctor_name: doctorName || 'د. محمد مطعني (Matany Group)',
      room_hall: roomHall || 'مدرج A - FUE',
      current_token: dynamicPayload.token,
      token_rotated_at: new Date().toISOString(),
      auto_save_seconds: autoSaveSeconds || 180, // 3 Minutes default
      status: 'ACTIVE',
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      session,
      dynamicQr: dynamicPayload
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/:id', async (req: Request, res: Response) => {
  try {
    let session = await db.getSession(req.params.id);
    if (!session) {
      const dynamicQr = generateDynamicQrToken(req.params.id);
      session = await db.createSession({
        id: req.params.id,
        course_name: 'هندسة البرمجيات المتقدمة (CSE 2026)',
        doctor_name: 'د. محمد مطعني (Matany Group)',
        room_hall: 'مدرج A - FUE',
        current_token: dynamicQr.token,
        token_rotated_at: new Date().toISOString(),
        auto_save_seconds: 180,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }

    const dynamicQr = generateDynamicQrToken(session.id);
    const records = await db.getSessionRecords(session.id);

    res.json({
      session,
      dynamicQr,
      recordsCount: records.length,
      records
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/:id/records', async (req: Request, res: Response) => {
  try {
    const records = await db.getSessionRecords(req.params.id);
    res.json(records);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/:id/check/:studentId', async (req: Request, res: Response) => {
  try {
    const record = await db.getAttendanceRecord(req.params.id, req.params.studentId);
    res.json({
      attended: Boolean(record),
      record: record || null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/:id/dynamic-token', async (req: Request, res: Response) => {
  try {
    let session = await db.getSession(req.params.id);
    if (!session) {
      const dynamicQr = generateDynamicQrToken(req.params.id);
      session = await db.createSession({
        id: req.params.id,
        course_name: 'هندسة البرمجيات المتقدمة (CSE 2026)',
        doctor_name: 'د. محمد مطعني (Matany Group)',
        room_hall: 'مدرج A - FUE',
        current_token: dynamicQr.token,
        token_rotated_at: new Date().toISOString(),
        auto_save_seconds: 180,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
      return res.json({ dynamicQr });
    }

    const dynamicQr = generateDynamicQrToken(session.id);
    await db.updateSessionToken(session.id, dynamicQr.token);

    // Broadcast token update
    broadcastToSession(session.id, 'TOKEN_ROTATED', dynamicQr);

    res.json({ dynamicQr });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// SSE Real-time Live Stream for Chrome Extension & Presenter
app.get('/api/session/:id/stream', (req: Request, res: Response) => {
  const sessionId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId)!.add(res);

  // Send initial ping
  res.write(`event: CONNECTED\ndata: ${JSON.stringify({ sessionId, timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    const clients = sseClients.get(sessionId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(sessionId);
      }
    }
  });
});

// Student Submits Dynamic QR or 8-Digit Numeric Code Attendance
app.post('/api/session/attend', async (req: Request, res: Response) => {
  try {
    const { sessionId, qrString, token, numericCode, studentId, deviceUuid } = req.body;

    if (!sessionId || !studentId) {
      return res.status(400).json({ error: 'معرف الجلسة ورقم الطالب مطلوبان' });
    }

    // Strict Device Lock Check during attendance
    if (deviceUuid) {
      const boundStudent = await db.getStudentByDevice(deviceUuid);
      if (boundStudent && boundStudent.id !== studentId) {
        return res.status(403).json({
          error: `تم رفض الحضور: هذا الجهاز مقترن رسمياً بحساب الطالب (${boundStudent.id}). يستحيل تسجيل حضور طالب آخر من نفس الجهاز حفاظاً على النزاهة الأكاديمية.`
        });
      }
    }

    // Extract token if raw qrString or URL was passed
    let effectiveToken = token;
    let effectiveSessionId = sessionId;
    let effectiveNumericCode = numericCode;

    if (qrString) {
      if (qrString.startsWith('AVQR:')) {
        const parts = qrString.split(':');
        effectiveSessionId = parts[1] || sessionId;
        effectiveToken = parts[2] || token;
        effectiveNumericCode = parts[3] || numericCode;
      } else if (qrString.includes('?') || qrString.startsWith('http://') || qrString.startsWith('https://')) {
        try {
          const urlObj = new URL(qrString.startsWith('http') ? qrString : `https://dummy.com/${qrString}`);
          effectiveSessionId = urlObj.searchParams.get('s') || urlObj.searchParams.get('sid') || effectiveSessionId;
          effectiveNumericCode = urlObj.searchParams.get('c') || urlObj.searchParams.get('code') || effectiveNumericCode;
          effectiveToken = urlObj.searchParams.get('k') || urlObj.searchParams.get('token') || effectiveToken;
        } catch (e) {}
      }
    }

    // 1. Check if student already attended this session (avoids duplicate processing and gives exact feedback)
    const existingRecord = await db.getAttendanceRecord(effectiveSessionId, studentId);
    if (existingRecord) {
      let arabicTime = existingRecord.check_time;
      try {
        arabicTime = new Intl.DateTimeFormat('ar-EG', {
          dateStyle: 'full',
          timeStyle: 'medium',
          hour12: true
        }).format(new Date(existingRecord.check_time));
      } catch (e) {}

      return res.json({
        success: true,
        alreadyAttended: true,
        reason: 'ALREADY_ATTENDED',
        message: `تم تسجيل حضورك مسبقاً في هذه المحاضرة بنجاح (بتاريخ: ${arabicTime}). حضورك معتمد ولا حاجة لإعادة التسجيل.`,
        record: existingRecord
      });
    }

    // 2. Check if session is closed
    let session = await db.getSession(effectiveSessionId);
    if (session && session.status === 'CLOSED') {
      return res.status(400).json({
        success: false,
        reason: 'SESSION_CLOSED',
        error: 'جلسة تسجيل الحضور مغلقة رسمياً أو انتهت المدة المحددة (3 دقائق). لا يمكن قبول تسجيلات جديدة.'
      });
    }

    // 3. Verify dynamic cryptographic token or 8-digit numeric code with exact time analysis
    const verification = verifyDynamicTokenDetailed(effectiveSessionId, effectiveToken, effectiveNumericCode);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        reason: verification.reason,
        error: verification.message
      });
    }

    // Ensure session exists
    if (!session) {
      session = await db.createSession({
        id: effectiveSessionId,
        course_name: 'مقدمة في هندسة البرمجيات (CSE 2026)',
        doctor_name: 'د. محمد مطعني (Matany Group)',
        room_hall: 'مدرج A - FUE',
        current_token: effectiveToken || 'INITIAL_TOKEN',
        token_rotated_at: new Date().toISOString(),
        auto_save_seconds: 180,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      });
    }

    // 4. Verify or auto-provision student
    let student = await db.getStudent(studentId);
    if (!student) {
      student = await db.upsertStudent({
        id: studentId,
        full_name: studentId === '20264712' ? 'Mohamed Ahmed Mohamed Matany Ahmed' : `طالب ${studentId}`,
        faculty: 'Engineering',
        level: '1-First',
        card_verified: true,
        card_ss_uuid: 'cc011cc7-ceb7-4867-973a-79d0a44e5214',
        card_verified_at: new Date().toISOString(),
        device_uuid: deviceUuid
      });
    } else {
      const updates: any = { id: student.id };
      if (!student.card_verified) {
        updates.card_verified = true;
        updates.full_name = student.id === '20264712' ? 'Mohamed Ahmed Mohamed Matany Ahmed' : student.full_name;
        updates.card_verified_at = new Date().toISOString();
      }
      if (deviceUuid && !student.device_uuid) {
        updates.device_uuid = deviceUuid;
      }
      student = await db.upsertStudent(updates);
    }

    // 5. Record attendance in database (strictly single attendance per student per session)
    const { record, isNew } = await db.recordAttendance(effectiveSessionId, student.id, student.full_name);

    if (isNew) {
      // 6. Instant Real-time Broadcast to Doctor's Chrome Extension
      broadcastToSession(effectiveSessionId, 'STUDENT_ATTENDED', {
        studentId: student.id,
        fullName: student.full_name,
        faculty: student.faculty,
        checkTime: record.check_time,
        recordId: record.id
      });
    }

    let arabicTime = record.check_time;
    try {
      arabicTime = new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'full',
        timeStyle: 'medium',
        hour12: true
      }).format(new Date(record.check_time));
    } catch (e) {}

    res.json({
      success: true,
      alreadyAttended: false,
      isNew: true,
      reason: 'ATTENDANCE_RECORDED',
      message: `تم إثبات وتسجيل حضورك بنجاح واعتماده في كشف المحاضر (بتاريخ: ${arabicTime}).`,
      student,
      record
    });
  } catch (error: any) {
    console.error('Attendance recording error:', error);
    res.status(500).json({ error: error.message || 'خطأ في تسجيل الحضور' });
  }
});

// Doctor Triggers Auto-Save or 3-Minute Expiry
app.post('/api/session/:id/auto-save', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    await db.markSessionSaved(sessionId);
    const records = await db.getSessionRecords(sessionId);

    broadcastToSession(sessionId, 'AUTO_SAVED', {
      sessionId,
      totalPresent: records.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `تم إتمام الحفظ التلقائي بنجاح لـ ${records.length} طالب بنسبة خطأ 0%`,
      totalPresent: records.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Support / Direct Help for Matany Group & University Admin
app.post('/api/support/contact', (req: Request, res: Response) => {
  res.json({
    matanyGroupSupport: 'support@matany.group',
    phone: '+20 100 000 0000',
    portal: 'https://upstore.one',
    universityAdmin: 'registrar@fue.edu.eg',
    message: 'فريق الدعم الفني لـ Matany Group متاح على مدار الساعة لدعم طلاب وأطباء جامعة FUE'
  });
});

// Automated Health check
app.get(['/health', '/api/health'], (req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    service: 'AVQR Server - Matany Group x FUE',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Start Server & Auto DB Init
if (!process.env.VERCEL) {
  initDb().then(() => {
    server.listen(PORT, () => {
      console.log(`[AVQR Server] Running on http://localhost:${PORT}`);
      console.log(`[AVQR Server] Matany Group x Future University in Egypt (FUE)`);
    });
  });
} else {
  initDb();
}

export { app, server };
export default app;
