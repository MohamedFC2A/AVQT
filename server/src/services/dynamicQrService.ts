import crypto from 'crypto';

const SECRET_SALT = process.env.AVQR_SECRET || 'MATANY_GROUP_AVQR_FUE_SECURITY_KEY_2026';
const ROTATION_INTERVAL_MS = 8000; // 8 seconds per rotation

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

  const payload: DynamicQrPayload = {
    type: 'AVQR_LECTURE',
    sessionId,
    token,
    numericCode,
    windowSeq,
    expiresInMs,
    expiresAt: nextWindowTime,
    qrString: `AVQR:${sessionId}:${token}:${numericCode}:${windowSeq}`
  };

  return payload;
}

export function verifyDynamicQrToken(sessionId: string, token: string): boolean {
  if (!sessionId || !token) return false;

  const now = Date.now();
  const currentSeq = Math.floor(now / ROTATION_INTERVAL_MS);

  // Allow current window, immediate previous window (-1), and next (+1) for latency leeway
  const candidateSeqs = [currentSeq, currentSeq - 1, currentSeq + 1];

  for (const seq of candidateSeqs) {
    const hmac = crypto.createHmac('sha256', SECRET_SALT);
    hmac.update(`${sessionId}:${seq}`);
    const expected = hmac.digest('hex').substring(0, 16);

    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);

    if (tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      return true;
    }
  }

  return false;
}

export function verifyDynamicNumericCode(sessionId: string, code: string): boolean {
  if (!sessionId || !code) return false;

  const cleanCode = code.replace(/[^0-9]/g, '');
  if (cleanCode.length !== 8) return false;

  const now = Date.now();
  const currentSeq = Math.floor(now / ROTATION_INTERVAL_MS);

  // Allow wider window (e.g. current and previous 3 windows = ~32 seconds) for manual student typing
  const candidateSeqs = [currentSeq, currentSeq - 1, currentSeq - 2, currentSeq - 3, currentSeq + 1];

  for (const seq of candidateSeqs) {
    const hmac = crypto.createHmac('sha256', SECRET_SALT);
    hmac.update(`${sessionId}:${seq}`);
    const token = hmac.digest('hex').substring(0, 16);
    const expectedCode = tokenTo8DigitCode(token);

    if (cleanCode === expectedCode) {
      return true;
    }
  }

  return false;
}
