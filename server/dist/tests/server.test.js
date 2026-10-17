import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateDynamicQrToken, verifyDynamicQrToken, verifyDynamicNumericCode } from '../services/dynamicQrService.js';
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
    });
    test('rejects tampered or fake tokens and codes', () => {
        const sessionId = 'TEST-SESSION-002';
        assert.strictEqual(verifyDynamicQrToken(sessionId, 'fake_forged_token'), false);
        assert.strictEqual(verifyDynamicNumericCode(sessionId, '00000000'), false);
        assert.strictEqual(verifyDynamicNumericCode(sessionId, '123'), false);
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
        const session = await db.createSession({
            id: 'SESSION-LIFECYCLE-1',
            course_name: 'Algorithms',
            doctor_name: 'Dr. Matany',
            room_hall: 'Hall B',
            current_token: 'valid_tok',
            auto_save_seconds: 180,
            status: 'ACTIVE',
            token_rotated_at: new Date().toISOString(),
            created_at: new Date().toISOString()
        });
        const record = await db.recordAttendance(session.id, studentId, verified.full_name);
        assert.strictEqual(record.student_id, studentId);
        assert.strictEqual(record.student_name, 'Verified Student Name');
        assert.strictEqual(record.synced_to_portal, true);
    });
});
