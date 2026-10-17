import crypto from 'crypto';

const SECRET_SALT = process.env.AVQR_SECRET || 'MATANY_GROUP_AVQR_FUE_SECURITY_KEY_2026';
const ROTATION_INTERVAL_MS = 8000; // 8 seconds per rotation

export interface DynamicQrPayload {
  type: 'AVQR_LECTURE';
  sessionId: string;
  token: string;
  windowSeq: number;
  expiresInMs: number;
  expiresAt: number;
  qrString: string;
}

export function generateDynamicQrToken(sessionId: string): DynamicQrPayload {
  const now = Date.now();
  const windowSeq = Math.floor(now / ROTATION_INTERVAL_MS);
  const nextWindowTime = (windowSeq + 1) * ROTATION_INTERVAL_MS;
  const expiresInMs = Math.max(0, nextWindowTime - now);

  const hmac = crypto.createHmac('sha256', SECRET_SALT);
  hmac.update(`${sessionId}:${windowSeq}`);
  const token = hmac.digest('hex').substring(0, 16);

  const payload = {
    type: 'AVQR_LECTURE' as const,
    sessionId,
    token,
    windowSeq,
    expiresInMs,
    expiresAt: nextWindowTime,
    qrString: `AVQR:${sessionId}:${token}:${windowSeq}`
  };

  return payload;
}

export function verifyDynamicQrToken(sessionId: string, token: string, windowSeq?: number): boolean {
  if (!sessionId || !token) return false;

  const now = Date.now();
  const currentSeq = Math.floor(now / ROTATION_INTERVAL_MS);

  // Allow current window, immediate previous window (-1), and next (+1) for clock skew
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
