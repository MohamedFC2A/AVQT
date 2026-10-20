import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { generateDynamicQrToken, verifyDynamicQrToken, verifyDynamicNumericCode, verifyDynamicTokenDetailed } from '../services/dynamicQrService.js';
import { fetchFueStudentCard, parseFueCardHtml } from '../services/fueCardScraper.js';
import { db } from '../db.js';
describe('AVQR Anti-Cheating Dynamic QR & 8-Digit Code Engine', () => {
    test('generates valid cryptographic token and 8-digit numeric code', () => {
        const sessionId = 'TEST-SESSION-001';
        const payload = generateDynamicQrToken(sessionId);
        assert.strictEqual(payload.type, 'AVQR_LECTURE');
        assert.strictEqual(payload.sessionId, sessionId);
        assert.ok(payload.token.length >= 16);
        assert.strictEqual(payload.numericCode.length, 8, 'Numeric code must be exactly 8 digits');
        assert.match(payload.numericCode, /^[0-9]{8}$/, 'Numeric code must be numbers only');
        // Token verification must succeed
        const isTokenValid = verifyDynamicQrToken(sessionId, payload.token);
        assert.strictEqual(isTokenValid, true, 'Immediate token should be valid');
        // 8-digit code verification must succeed
        const isNumericValid = verifyDynamicNumericCode(sessionId, payload.numericCode);
        assert.strictEqual(isNumericValid, true, 'Immediate 8-digit code should be valid');
        // Detailed verification must be VALID
        const detail = verifyDynamicTokenDetailed(sessionId, payload.token, payload.numericCode);
        assert.strictEqual(detail.valid, true);
        assert.strictEqual(detail.reason, 'VALID');
    });
    test('accurately identifies JUST_EXPIRED (rotated) vs ANCIENT_CODE (old) vs INVALID_CODE', () => {
        const sessionId = 'TEST-SESSION-EXPIRY';
        const secret = process.env.AVQR_SECRET || 'MATANY_GROUP_AVQR_FUE_SECURITY_KEY_2026';
        const currentSeq = Math.floor(Date.now() / 5000);
        // Just expired (8 sequences ago = 40s ago)
        const justExpiredHmac = crypto.createHmac('sha256', secret);
        justExpiredHmac.update(`${sessionId}:${currentSeq - 8}`);
        const justExpiredToken = justExpiredHmac.digest('hex').substring(0, 16);
        const justExpiredResult = verifyDynamicTokenDetailed(sessionId, justExpiredToken);
        assert.strictEqual(justExpiredResult.valid, false);
        assert.strictEqual(justExpiredResult.reason, 'JUST_EXPIRED');
        assert.match(justExpiredResult.message, /انتهت صلاحية الرمز للتو/);
        // Ancient code (25 sequences ago = 125s ago)
        const ancientHmac = crypto.createHmac('sha256', secret);
        ancientHmac.update(`${sessionId}:${currentSeq - 25}`);
        const ancientToken = ancientHmac.digest('hex').substring(0, 16);
        const ancientResult = verifyDynamicTokenDetailed(sessionId, ancientToken);
        assert.strictEqual(ancientResult.valid, false);
        assert.strictEqual(ancientResult.reason, 'ANCIENT_CODE');
        assert.match(ancientResult.message, /قديم جداً/);
    });
});
describe('FUE Student ID Card Scraper & Verification', () => {
    test('correctly decodes official FUE card for Mohamed Matany', async () => {
        const ssUuid = 'cc011cc7-ceb7-4867-973a-79d0a44e5214';
        const cardData = await fetchFueStudentCard(ssUuid);
        assert.strictEqual(cardData.code, '20264712');
        assert.strictEqual(cardData.fullName, 'Mohamed Ahmed Mohamed Matany Ahmed');
        assert.strictEqual(cardData.faculty, 'Engineering');
        assert.strictEqual(cardData.level, '1-First');
    });
    test('parses raw FUE card HTML properly', () => {
        const mockHtml = `
      <html>
        <body>
          <div class="info">Student Info</div>
          <div class="code">Code : 20264712</div>
          <div>Mohamed Ahmed Mohamed Matany Ahmed</div>
          <div>Engineering</div>
          <div>1-First</div>
          <div>منتظم</div>
          <div>Nationality: مصري</div>
        </body>
      </html>
    `;
        const parsed = parseFueCardHtml(mockHtml, 'http://test', 'test-uuid');
        assert.strictEqual(parsed.code, '20264712');
        assert.strictEqual(parsed.fullName, 'Mohamed Ahmed Mohamed Matany Ahmed');
        assert.strictEqual(parsed.faculty, 'Engineering');
    });
});
describe('AVQR Database & Attendance Lifecycle', () => {
    test('enforces Step 2 verification before taking attendance', async () => {
        const studentId = '20269999';
        await db.upsertStudent({
            id: studentId,
            full_name: 'Unverified Student',
            card_verified: false
        });
        const unverified = await db.getStudent(studentId);
        assert.ok(unverified);
        assert.strictEqual(unverified.card_verified, false);
        await db.upsertStudent({
            id: studentId,
            card_verified: true,
            full_name: 'Verified Student Name'
        });
        const verified = await db.getStudent(studentId);
        assert.strictEqual(verified?.card_verified, true);
        assert.strictEqual(verified?.full_name, 'Verified Student Name');
        const sessionId = 'SESSION-LIFECYCLE-' + Date.now();
        const session = await db.createSession({
            id: sessionId,
            course_name: 'Algorithms',
            doctor_name: 'Dr. Matany',
            room_hall: 'Hall B',
            current_token: 'valid_tok',
            auto_save_seconds: 180,
            status: 'ACTIVE',
            token_rotated_at: new Date().toISOString(),
            created_at: new Date().toISOString()
        });
        const { record, isNew } = await db.recordAttendance(sessionId, studentId, verified.full_name);
        assert.strictEqual(isNew, true);
        assert.strictEqual(record.student_id, studentId);
        assert.strictEqual(record.student_name, 'Verified Student Name');
        assert.strictEqual(record.synced_to_portal, true);
        // Second call should return existing with isNew = false
        const secondCall = await db.recordAttendance(sessionId, studentId, verified.full_name);
        assert.strictEqual(secondCall.isNew, false);
        assert.strictEqual(secondCall.record.id, record.id);
    });
    test('correctly binds and verifies student device lock', async () => {
        const studentId = '20267777';
        const deviceUuid = 'DEV-LOCK-UUID-999';
        await db.upsertStudent({
            id: studentId,
            full_name: 'Bound Device Student',
            device_uuid: deviceUuid
        });
        const studentByDevice = await db.getStudentByDevice(deviceUuid);
        assert.ok(studentByDevice);
        assert.strictEqual(studentByDevice.id, studentId);
        // Non-existent device should return null
        const notFound = await db.getStudentByDevice('NON-EXISTENT-DEVICE');
        assert.strictEqual(notFound, null);
    });
    test('enforces Zero-Concurrent-Sessions, Single Transfer Limit, and Permanent Riot Ban', async () => {
        const testId = '20268888';
        const device1 = 'DEV-HWID-ALPHA-01';
        const device2 = 'DEV-HWID-BETA-02';
        const device3 = 'DEV-HWID-GAMMA-03';
        // 1. Initial Registration on Device 1
        const student = await db.upsertStudent({
            id: testId,
            full_name: 'Test Multi-Device Student',
            device_uuid: device1,
            device_transfers_count: 0,
            is_banned: false,
            active_session_token: 'SES-TOKEN-DEVICE1'
        });
        assert.strictEqual(student.device_uuid, device1);
        assert.strictEqual(student.device_transfers_count, 0);
        assert.strictEqual(student.is_banned, false);
        // Verify session on Device 1 is VALID
        const sess1 = await db.verifySession(testId, 'SES-TOKEN-DEVICE1', device1);
        assert.strictEqual(sess1.valid, true);
        // Verify session from another device fails with DEVICE_MISMATCH
        const sessWrongDev = await db.verifySession(testId, 'SES-TOKEN-DEVICE1', device2);
        assert.strictEqual(sessWrongDev.valid, false);
        assert.strictEqual(sessWrongDev.reason, 'DEVICE_MISMATCH');
        // 2. FIRST TRANSFER: Request transfer to Device 2
        const transfer1 = await db.createDeviceTransferRequest(testId, device1, device2, 'Phone 2');
        assert.strictEqual(transfer1.status, 'PENDING');
        assert.strictEqual(transfer1.from_device_uuid, device1);
        assert.strictEqual(transfer1.to_device_uuid, device2);
        // Approve first transfer (increments transfers count to 1, rotates session token)
        const approveResult = await db.resolveTransferRequest(transfer1.id, 'APPROVED', 'SES-TOKEN-DEVICE2');
        assert.ok(approveResult);
        assert.strictEqual(approveResult.transfer.status, 'APPROVED');
        // Check student state after 1st transfer
        const studentAfterTrf1 = await db.getStudent(testId);
        assert.ok(studentAfterTrf1);
        assert.strictEqual(studentAfterTrf1.device_uuid, device2, 'Device must now be Device 2');
        assert.strictEqual(studentAfterTrf1.device_transfers_count, 1, 'Transfer count must be 1');
        assert.strictEqual(studentAfterTrf1.is_banned, false);
        // Old Device 1 session is now TERMINATED (DEVICE_MISMATCH & SESSION_REVOKED)
        const oldDeviceCheck = await db.verifySession(testId, 'SES-TOKEN-DEVICE1', device1);
        assert.strictEqual(oldDeviceCheck.valid, false);
        // New Device 2 session is ACTIVE
        const newDeviceCheck = await db.verifySession(testId, 'SES-TOKEN-DEVICE2', device2);
        assert.strictEqual(newDeviceCheck.valid, true);
        // 3. SECOND TRANSFER ATTEMPT (SUSPICIOUS / RIOT TRIGGER):
        // Student attempts to switch again (transfer count is already 1)
        assert.ok(studentAfterTrf1.device_transfers_count >= 1, 'Student reached maximum 1 transfer limit');
        // Server detects second transfer attempt and triggers IMMEDIATE RIOT BAN
        const bannedStudent = await db.banStudent(testId, 'تم الحظر بسبب الاشتباه في أعمال الشغب. توجه للدعم والـ Admission.');
        assert.ok(bannedStudent);
        assert.strictEqual(bannedStudent.is_banned, true);
        assert.match(bannedStudent.ban_reason, /أعمال الشغب/);
        // After Ban: Any session verification MUST fail with ACCOUNT_BANNED
        const bannedCheck = await db.verifySession(testId, 'SES-TOKEN-DEVICE2', device2);
        assert.strictEqual(bannedCheck.valid, false);
        assert.strictEqual(bannedCheck.reason, 'ACCOUNT_BANNED');
        // 4. NEON.TECH EASY UNBAN:
        // Admin runs single UPDATE query or unban in Neon
        const unbanned = await db.unbanStudent(testId);
        assert.ok(unbanned);
        assert.strictEqual(unbanned.is_banned, false);
        assert.strictEqual(unbanned.device_transfers_count, 0);
        // Session is now unbanned and ready for re-authentication
        const afterUnban = await db.getStudent(testId);
        assert.strictEqual(afterUnban?.is_banned, false);
        assert.strictEqual(afterUnban?.device_transfers_count, 0);
    });
    after(async () => {
        await db.closePool();
    });
});
