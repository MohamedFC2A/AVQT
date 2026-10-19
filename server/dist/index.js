import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, initDb } from './db.js';
import { fetchFueStudentCard } from './services/fueCardScraper.js';
import { generateDynamicQrToken, verifyDynamicTokenDetailed } from './services/dynamicQrService.js';
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
const sseClients = new Map();
function broadcastToSession(sessionId, event, data) {
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
app.post('/api/auth/register', async (req, res) => {
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
        let passwordHash;
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
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'خطأ في الخادم' });
    }
});
app.post('/api/auth/login', async (req, res) => {
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
        }
        else {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message || 'خطأ في الخادم' });
    }
});
// Biometric WebAuthn Mock / Registration API
app.post('/api/auth/biometric/register', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/auth/biometric/login', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// -------------------------------------------------------------
// 2. FUE ID Card QR Code Verification (Step 2 - One Time Only)
// -------------------------------------------------------------
app.post('/api/student/verify-card', async (req, res) => {
    try {
        const { studentId, cardUrlOrUuid } = req.body;
        if (!studentId || !cardUrlOrUuid) {
            return res.status(400).json({ error: 'الرقم الجامعي ورابط أو كود الكارنيه مطلوبان' });
        }
        console.log(`[FUE Card Verification] Fetching card for ${studentId} with source: ${cardUrlOrUuid}`);
        const cardData = await fetchFueStudentCard(cardUrlOrUuid);
        // Verify code match or update student record
        const updated = await db.upsertStudent({
            id: studentId,
            full_name: cardData.fullName,
            faculty: cardData.faculty,
            level: cardData.level,
            card_verified: true,
            card_ss_uuid: cardData.ssUuid,
            card_verified_at: new Date().toISOString()
        });
        res.json({
            success: true,
            message: 'تم التحقق من كارنيه جامعة المستقبل (FUE) واعتماد الاسم الرسمي للأبد بنجاح',
            student: updated,
            cardData
        });
    }
    catch (error) {
        console.error('Card verification error:', error);
        res.status(500).json({ error: 'تعذر التحقق من كود الكارنيه: ' + (error.message || '') });
    }
});
app.get('/api/student/profile/:id', async (req, res) => {
    try {
        const student = await db.getStudent(req.params.id);
        if (!student) {
            return res.status(404).json({ error: 'الطالب غير موجود' });
        }
        res.json({ student });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// -------------------------------------------------------------
// 3. Attendance Sessions & Dynamic Rotating QR (Step 3)
// -------------------------------------------------------------
app.post('/api/session/create', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/session/:id', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/session/:id/records', async (req, res) => {
    try {
        const records = await db.getSessionRecords(req.params.id);
        res.json(records);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/session/:id/check/:studentId', async (req, res) => {
    try {
        const record = await db.getAttendanceRecord(req.params.id, req.params.studentId);
        res.json({
            attended: Boolean(record),
            record: record || null
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/session/:id/dynamic-token', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// SSE Real-time Live Stream for Chrome Extension & Presenter
app.get('/api/session/:id/stream', (req, res) => {
    const sessionId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    if (!sseClients.has(sessionId)) {
        sseClients.set(sessionId, new Set());
    }
    sseClients.get(sessionId).add(res);
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
app.post('/api/session/attend', async (req, res) => {
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
            }
            else if (qrString.includes('?') || qrString.startsWith('http://') || qrString.startsWith('https://')) {
                try {
                    const urlObj = new URL(qrString.startsWith('http') ? qrString : `https://dummy.com/${qrString}`);
                    effectiveSessionId = urlObj.searchParams.get('s') || urlObj.searchParams.get('sid') || effectiveSessionId;
                    effectiveNumericCode = urlObj.searchParams.get('c') || urlObj.searchParams.get('code') || effectiveNumericCode;
                    effectiveToken = urlObj.searchParams.get('k') || urlObj.searchParams.get('token') || effectiveToken;
                }
                catch (e) { }
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
            }
            catch (e) { }
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
        }
        else {
            const updates = { id: student.id };
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
        }
        catch (e) { }
        res.json({
            success: true,
            alreadyAttended: false,
            isNew: true,
            reason: 'ATTENDANCE_RECORDED',
            message: `تم إثبات وتسجيل حضورك بنجاح واعتماده في كشف المحاضر (بتاريخ: ${arabicTime}).`,
            student,
            record
        });
    }
    catch (error) {
        console.error('Attendance recording error:', error);
        res.status(500).json({ error: error.message || 'خطأ في تسجيل الحضور' });
    }
});
// Doctor Triggers Auto-Save or 3-Minute Expiry
app.post('/api/session/:id/auto-save', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Support / Direct Help for Matany Group & University Admin
app.post('/api/support/contact', (req, res) => {
    res.json({
        matanyGroupSupport: 'support@matany.group',
        phone: '+20 100 000 0000',
        portal: 'https://upstore.one',
        universityAdmin: 'registrar@fue.edu.eg',
        message: 'فريق الدعم الفني لـ Matany Group متاح على مدار الساعة لدعم طلاب وأطباء جامعة FUE'
    });
});
// Automated Health check
app.get(['/health', '/api/health'], (req, res) => {
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
}
else {
    initDb();
}
export { app, server };
export default app;
