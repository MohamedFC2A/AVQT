import crypto from 'crypto';

const SECRET_SALT = process.env.AVQR_SECRET || 'MATANY_GROUP_AVQR_FUE_SECURITY_KEY_2026';
const ROTATION_INTERVAL_MS = 5000; // 5-second ultra-fast rotation (anti-screenshot & anti-WhatsApp)

export interface DynamicQrPayload {
  type: 'AVQR_LECTURE';
  sessionId: string;
  token: string;
  numericCode: string; // 8-digit manual fallback code
  windowSeq: number;
  expiresInMs: number;
  expiresAt: number;
  qrString: string;
}

// Convert HMAC digest slice into an 8-digit clean decimal string
function tokenTo8DigitCode(token: string): string {
  const hexPart = token.substring(0, 8);
  const num = parseInt(hexPart, 16);
  const code8 = (num % 90000000 + 10000000).toString();
  return code8;
}

export function generateDynamicQrToken(sessionId: string): DynamicQrPayload {
  const now = Date.now();
  const windowSeq = Math.floor(now / ROTATION_INTERVAL_MS);
  const nextWindowTime = (windowSeq + 1) * ROTATION_INTERVAL_MS;
  const expiresInMs = Math.max(0, nextWindowTime - now);

  const hmac = crypto.createHmac('sha256', SECRET_SALT);
  hmac.update(`${sessionId}:${windowSeq}`);
  const token = hmac.digest('hex').substring(0, 16);
  const numericCode = tokenTo8DigitCode(token);

  const baseUrl = process.env.APP_URL || 'https://avqr-matany-fue.vercel.app';
  // Include micro-timestamp for anti-replay verification
  const actionUrl = `${baseUrl}/?attend=1&sid=${encodeURIComponent(sessionId)}&code=${numericCode}&token=${token}&t=${now}`;

  const payload: DynamicQrPayload = {
    type: 'AVQR_LECTURE',
    sessionId,
    token,
    numericCode,
    windowSeq,
    expiresInMs,
    expiresAt: nextWindowTime,
    qrString: actionUrl
  };

  return payload;
}

export interface VerificationResult {
  valid: boolean;
  reason: 'VALID' | 'JUST_EXPIRED' | 'ANCIENT_CODE' | 'INVALID_CODE' | 'MISSING';
  message: string;
  windowDiff?: number;
}

export function verifyDynamicTokenDetailed(sessionId: string, token?: string, numericCode?: string): VerificationResult {
  if (!sessionId || (!token && !numericCode)) {
    return {
      valid: false,
      reason: 'MISSING',
      message: 'رمز الحضور أو الكود المكون من 8 أرقام مطلوب.'
    };
  }

  const cleanCode = numericCode ? numericCode.replace(/[^0-9]/g, '') : '';
  const now = Date.now();
  const currentSeq = Math.floor(now / ROTATION_INTERVAL_MS);

  // Search window from future skew (+1) back to 10 minutes ago (-120 sequences)
  for (let seq = currentSeq + 1; seq >= currentSeq - 120; seq--) {
    const hmac = crypto.createHmac('sha256', SECRET_SALT);
    hmac.update(`${sessionId}:${seq}`);
    const expectedToken = hmac.digest('hex').substring(0, 16);
    const expectedCode = tokenTo8DigitCode(expectedToken);

    const tokenMatch = Boolean(token && token === expectedToken);
    const codeMatch = Boolean(cleanCode && cleanCode.length === 8 && cleanCode === expectedCode);

    if (tokenMatch || codeMatch) {
      const diff = currentSeq - seq;
      if (diff <= 1 && diff >= -1) {
        return {
          valid: true,
          reason: 'VALID',
          message: 'رمز الحضور ساري وصحيح.',
          windowDiff: diff
        };
      } else if (diff >= 2 && diff <= 5) {
        return {
          valid: false,
          reason: 'JUST_EXPIRED',
          message: 'انتهت صلاحية الرمز للتو (تم تدوير رمز QR). لقد تغير الكود المعروض على الشاشة منذ لحظات، يرجى كتابة أو مسح الرمز الجديد الظاهر الآن.',
          windowDiff: diff
        };
      } else {
        return {
          valid: false,
          reason: 'ANCIENT_CODE',
          message: 'رمز QR قديم جداً أو غير صالح كلياً. تم إرسال أو مسح كود منتهي الصلاحية منذ فترة. تأكد من مسح الرمز الحي المباشر من شاشة المحاضرة الآن.',
          windowDiff: diff
        };
      }
    }
  }

  return {
    valid: false,
    reason: 'INVALID_CODE',
    message: 'الرمز غير صحيح أو لا ينتمي إلى هذه المحاضرة. تأكد من صحة مسح الكود أو كتابة 8 أرقام صحيحة.'
  };
}

export function verifyDynamicQrToken(sessionId: string, token: string): boolean {
  return verifyDynamicTokenDetailed(sessionId, token).valid;
}

export function verifyDynamicNumericCode(sessionId: string, code: string): boolean {
  return verifyDynamicTokenDetailed(sessionId, undefined, code).valid;
}

