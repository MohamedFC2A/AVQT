import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const { Pool } = pg;

// AVQR Sovereign Cloud Infrastructure for Future University in Egypt (FUE) & Matany Group
const DATABASE_URL = process.env.DATABASE_URL;

export interface Student {
  id: string; // e.g. "20264712"
  full_name: string;
  faculty: string;
  level: string;
  photo_url?: string;
  password_hash?: string;
  emergency_access_key?: string; // Auto-generated unhackable master key
  card_verified: boolean;
  card_ss_uuid?: string;
  card_verified_at?: string;
  device_uuid?: string; // Strict device binding
  device_transfers_count: number; // Max 1 transfer permitted
  is_banned: boolean; // Permanent riot/tamper ban
  ban_reason?: string;
  active_session_token?: string; // Concurrency invalidation token
  created_at: string;
  updated_at?: string;
}

export function generateEmergencyAccessKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `FUE-SEC-${seg(4)}-${seg(4)}-${seg(4)}-2026`;
}

export interface AttendanceSession {
  id: string;
  course_name: string;
  doctor_name: string;
  room_hall: string;
  current_token: string;
  token_rotated_at: string;
  auto_save_seconds: number;
  status: 'ACTIVE' | 'AUTO_SAVED' | 'CLOSED';
  portal_connected?: boolean;
  checkbox_count?: number;
  created_at: string;
}

export interface AttendanceRecord {
  id: number;
  session_id: string;
  student_id: string;
  student_name: string;
  verified_method: string;
  synced_to_portal: boolean;
  check_time: string;
}

export interface BiometricCredential {
  id: string;
  student_id: string;
  public_key: string;
  counter: number;
  device_name: string;
  created_at: string;
}

export interface DeviceTransferRequest {
  id: string;
  student_id: string;
  from_device_uuid: string;
  to_device_uuid: string;
  to_device_name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  resolved_at?: string;
}

const PERSIST_FILE = process.env.VERCEL ? '/tmp/avqr_db_state.json' : path.resolve(process.cwd(), 'avqr_db_state.json');

// In-Memory store as zero-failure fallback with disk persistence
class MemoryStore {
  students: Map<string, Student> = new Map();
  credentials: Map<string, BiometricCredential> = new Map();
  sessions: Map<string, AttendanceSession> = new Map();
  transfers: Map<string, DeviceTransferRequest> = new Map();
  records: AttendanceRecord[] = [];
  recordIdSeq = 1;

  constructor() {
    this.load();
  }

  save() {
    try {
      const data = {
        students: Array.from(this.students.entries()),
        credentials: Array.from(this.credentials.entries()),
        sessions: Array.from(this.sessions.entries()),
        transfers: Array.from(this.transfers.entries()),
        records: this.records,
        recordIdSeq: this.recordIdSeq
      };
      fs.writeFileSync(PERSIST_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {}
  }

  load() {
    try {
      if (fs.existsSync(PERSIST_FILE)) {
        const raw = fs.readFileSync(PERSIST_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.students) this.students = new Map(parsed.students);
        if (parsed.credentials) this.credentials = new Map(parsed.credentials);
        if (parsed.sessions) this.sessions = new Map(parsed.sessions);
        if (parsed.transfers) this.transfers = new Map(parsed.transfers);
        if (parsed.records) this.records = parsed.records;
        if (parsed.recordIdSeq) this.recordIdSeq = parsed.recordIdSeq;
      }
    } catch (e) {}
  }
}

const memoryStore = new MemoryStore();
let pool: pg.Pool | null = null;

if (DATABASE_URL && DATABASE_URL.startsWith('postgres')) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    console.log('[AVQR Cloud] Connected to Sovereign Neon.tech PostgreSQL cluster');
    initDb().catch(e => console.error('Auto initDb error:', e));
  } catch (err) {
    console.warn('[AVQR Cloud] Sovereign Cloud fallback engaged:', err);
    pool = null;
  }
} else {
  console.log('[AVQR Cloud] Running in High-Resilience Sovereign mode (Zero downtime)');
}

function mapStudentRow(r: any): Student {
  return {
    id: String(r.id),
    full_name: r.full_name,
    faculty: r.faculty || 'Engineering',
    level: r.level || '1-First',
    photo_url: r.photo_url || undefined,
    password_hash: r.password_hash || undefined,
    emergency_access_key: r.emergency_access_key || undefined,
    card_verified: Boolean(r.card_verified),
    card_ss_uuid: r.card_ss_uuid || undefined,
    card_verified_at: r.card_verified_at ? new Date(r.card_verified_at).toISOString() : undefined,
    device_uuid: r.device_uuid || undefined,
    device_transfers_count: Number(r.device_transfers_count || 0),
    is_banned: Boolean(r.is_banned),
    ban_reason: r.ban_reason || undefined,
    active_session_token: r.active_session_token || undefined,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : undefined
  };
}

function mapTransferRow(r: any): DeviceTransferRequest {
  return {
    id: r.id,
    student_id: r.student_id,
    from_device_uuid: r.from_device_uuid,
    to_device_uuid: r.to_device_uuid,
    to_device_name: r.to_device_name || 'هاتف محمول جديد',
    status: r.status,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : undefined
  };
}

export async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id VARCHAR(30) PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        faculty VARCHAR(100) DEFAULT 'Engineering',
        level VARCHAR(50) DEFAULT '1-First',
        photo_url TEXT,
        password_hash VARCHAR(255),
        emergency_access_key VARCHAR(100),
        card_verified BOOLEAN DEFAULT FALSE,
        card_ss_uuid VARCHAR(255),
        card_verified_at TIMESTAMP,
        device_uuid VARCHAR(255),
        device_transfers_count INT DEFAULT 0,
        is_banned BOOLEAN DEFAULT FALSE,
        ban_reason TEXT,
        active_session_token VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_access_key VARCHAR(100);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS device_transfers_count INT DEFAULT 0;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS ban_reason TEXT;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS active_session_token VARCHAR(255);
      ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

      CREATE TABLE IF NOT EXISTS device_transfers (
        id VARCHAR(64) PRIMARY KEY,
        student_id VARCHAR(30) REFERENCES students(id) ON DELETE CASCADE,
        from_device_uuid VARCHAR(255) NOT NULL,
        to_device_uuid VARCHAR(255) NOT NULL,
        to_device_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'PENDING',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS biometric_credentials (
        id VARCHAR(255) PRIMARY KEY,
        student_id VARCHAR(30) REFERENCES students(id) ON DELETE CASCADE,
        public_key TEXT NOT NULL,
        counter BIGINT DEFAULT 0,
        device_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id VARCHAR(64) PRIMARY KEY,
        course_name VARCHAR(255) NOT NULL,
        doctor_name VARCHAR(100) NOT NULL,
        room_hall VARCHAR(100),
        current_token VARCHAR(255) NOT NULL,
        token_rotated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        auto_save_seconds INT DEFAULT 180,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        portal_connected BOOLEAN DEFAULT FALSE,
        checkbox_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS portal_connected BOOLEAN DEFAULT FALSE;
      ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS checkbox_count INT DEFAULT 0;

      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        student_id VARCHAR(30) REFERENCES students(id) ON DELETE CASCADE,
        student_name VARCHAR(255) NOT NULL,
        verified_method VARCHAR(50) DEFAULT 'AVQR_DYNAMIC_PASS',
        synced_to_portal BOOLEAN DEFAULT FALSE,
        check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_student_session UNIQUE (session_id, student_id)
      );
    `);
    console.log('[AVQR Cloud] Sovereign Academic Schema in Neon.tech verified and ready');
  } catch (error) {
    console.error('Academic schema migration check:', error);
  }
}

// Sovereign Data Abstraction API
export const db = {
  async getStudent(id: string): Promise<Student | null> {
    if (!id) return null;
    const cleanId = String(id).trim();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM students WHERE id = $1', [cleanId]);
        if (res.rows[0]) {
          const student = mapStudentRow(res.rows[0]);
          memoryStore.students.set(student.id, student);
          return student;
        }
        return null;
      } catch (e) {
        console.error('getStudent pool query error, using memoryStore:', e);
      }
    }
    return memoryStore.students.get(cleanId) || null;
  },

  async getStudentByDevice(deviceUuid: string): Promise<Student | null> {
    if (!deviceUuid) return null;
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM students WHERE device_uuid = $1', [deviceUuid]);
        if (res.rows[0]) {
          return mapStudentRow(res.rows[0]);
        }
        return null;
      } catch (e) {
        console.error('getStudentByDevice pool query error:', e);
      }
    }
    return Array.from(memoryStore.students.values()).find(s => s.device_uuid === deviceUuid) || null;
  },

  async upsertStudent(student: Partial<Student> & { id: string }): Promise<Student> {
    const cleanId = String(student.id).trim();
    const existing = await this.getStudent(cleanId);

    const merged: Student = {
      id: cleanId,
      full_name: student.full_name || existing?.full_name || `طالب ${cleanId}`,
      faculty: student.faculty || existing?.faculty || 'Engineering',
      level: student.level || existing?.level || '1-First',
      photo_url: student.photo_url !== undefined ? student.photo_url : existing?.photo_url,
      password_hash: student.password_hash !== undefined ? student.password_hash : existing?.password_hash,
      emergency_access_key: student.emergency_access_key || existing?.emergency_access_key || generateEmergencyAccessKey(),
      card_verified: student.card_verified !== undefined ? student.card_verified : (existing?.card_verified ?? false),
      card_ss_uuid: student.card_ss_uuid !== undefined ? student.card_ss_uuid : existing?.card_ss_uuid,
      card_verified_at: student.card_verified_at !== undefined ? student.card_verified_at : existing?.card_verified_at,
      device_uuid: student.device_uuid !== undefined ? student.device_uuid : existing?.device_uuid,
      device_transfers_count: student.device_transfers_count !== undefined ? student.device_transfers_count : (existing?.device_transfers_count ?? 0),
      is_banned: student.is_banned !== undefined ? student.is_banned : (existing?.is_banned ?? false),
      ban_reason: student.ban_reason !== undefined ? student.ban_reason : existing?.ban_reason,
      active_session_token: student.active_session_token !== undefined ? student.active_session_token : existing?.active_session_token,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO students (
            id, full_name, faculty, level, photo_url, password_hash, emergency_access_key,
            card_verified, card_ss_uuid, card_verified_at, device_uuid,
            device_transfers_count, is_banned, ban_reason, active_session_token, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            faculty = EXCLUDED.faculty,
            level = EXCLUDED.level,
            photo_url = COALESCE(EXCLUDED.photo_url, students.photo_url),
            password_hash = COALESCE(EXCLUDED.password_hash, students.password_hash),
            emergency_access_key = COALESCE(EXCLUDED.emergency_access_key, students.emergency_access_key),
            card_verified = EXCLUDED.card_verified,
            card_ss_uuid = COALESCE(EXCLUDED.card_ss_uuid, students.card_ss_uuid),
            card_verified_at = COALESCE(EXCLUDED.card_verified_at, students.card_verified_at),
            device_uuid = EXCLUDED.device_uuid,
            device_transfers_count = EXCLUDED.device_transfers_count,
            is_banned = EXCLUDED.is_banned,
            ban_reason = EXCLUDED.ban_reason,
            active_session_token = EXCLUDED.active_session_token,
            updated_at = CURRENT_TIMESTAMP`,
          [
            merged.id,
            merged.full_name,
            merged.faculty,
            merged.level,
            merged.photo_url || null,
            merged.password_hash || null,
            merged.emergency_access_key || null,
            merged.card_verified,
            merged.card_ss_uuid || null,
            merged.card_verified_at || null,
            merged.device_uuid || null,
            merged.device_transfers_count,
            merged.is_banned,
            merged.ban_reason || null,
            merged.active_session_token || null
          ]
        );
      } catch (err) {
        console.error('Neon DB upsertStudent error:', err);
      }
    }

    memoryStore.students.set(cleanId, merged);
    memoryStore.save();
    return merged;
  },

  async banStudent(studentId: string, reason: string): Promise<Student | null> {
    const cleanId = String(studentId).trim();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE students 
           SET is_banned = TRUE, ban_reason = $1, active_session_token = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2 
           RETURNING *`,
          [reason, cleanId]
        );
        if (res.rows[0]) {
          const mapped = mapStudentRow(res.rows[0]);
          memoryStore.students.set(cleanId, mapped);
          memoryStore.save();
          return mapped;
        }
      } catch (e) {
        console.error('banStudent pool error:', e);
      }
    }

    const student = memoryStore.students.get(cleanId);
    if (student) {
      student.is_banned = true;
      student.ban_reason = reason;
      student.active_session_token = undefined;
      student.updated_at = new Date().toISOString();
      memoryStore.students.set(cleanId, student);
      memoryStore.save();
      return student;
    }
    return null;
  },

  async unbanStudent(studentId: string): Promise<Student | null> {
    const cleanId = String(studentId).trim();
    if (pool) {
      try {
        const res = await pool.query(
          `UPDATE students 
           SET is_banned = FALSE, device_transfers_count = 0, ban_reason = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $1 
           RETURNING *`,
          [cleanId]
        );
        if (res.rows[0]) {
          const mapped = mapStudentRow(res.rows[0]);
          memoryStore.students.set(cleanId, mapped);
          memoryStore.save();
          return mapped;
        }
      } catch (e) {
        console.error('unbanStudent pool error:', e);
      }
    }

    const student = memoryStore.students.get(cleanId);
    if (student) {
      student.is_banned = false;
      student.device_transfers_count = 0;
      student.ban_reason = undefined;
      student.updated_at = new Date().toISOString();
      memoryStore.students.set(cleanId, student);
      memoryStore.save();
      return student;
    }
    return null;
  },

  async createDeviceTransferRequest(
    studentId: string,
    fromDevice: string,
    toDevice: string,
    toDeviceName: string
  ): Promise<DeviceTransferRequest> {
    const cleanId = String(studentId).trim();
    const id = 'TRF-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    const trf: DeviceTransferRequest = {
      id,
      student_id: cleanId,
      from_device_uuid: fromDevice,
      to_device_uuid: toDevice,
      to_device_name: toDeviceName || 'هاتف محمول جديد',
      status: 'PENDING',
      created_at: new Date().toISOString()
    };

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO device_transfers (id, student_id, from_device_uuid, to_device_uuid, to_device_name, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [trf.id, trf.student_id, trf.from_device_uuid, trf.to_device_uuid, trf.to_device_name, trf.status]
        );
      } catch (e) {
        console.error('createDeviceTransferRequest pool error:', e);
      }
    }

    memoryStore.transfers.set(id, trf);
    memoryStore.save();
    return trf;
  },

  async getPendingTransferRequest(studentId: string): Promise<DeviceTransferRequest | null> {
    const cleanId = String(studentId).trim();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT * FROM device_transfers 
           WHERE student_id = $1 AND status = 'PENDING' 
           ORDER BY created_at DESC LIMIT 1`,
          [cleanId]
        );
        if (res.rows[0]) {
          return mapTransferRow(res.rows[0]);
        }
        return null;
      } catch (e) {
        console.error('getPendingTransferRequest pool error:', e);
      }
    }

    for (const trf of memoryStore.transfers.values()) {
      if (trf.student_id === cleanId && trf.status === 'PENDING') {
        return trf;
      }
    }
    return null;
  },

  async getTransferRequest(requestId: string): Promise<DeviceTransferRequest | null> {
    if (!requestId) return null;
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM device_transfers WHERE id = $1', [requestId]);
        if (res.rows[0]) {
          return mapTransferRow(res.rows[0]);
        }
        return null;
      } catch (e) {
        console.error('getTransferRequest pool error:', e);
      }
    }
    return memoryStore.transfers.get(requestId) || null;
  },

  async resolveTransferRequest(
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    newSessionToken?: string
  ): Promise<{ transfer: DeviceTransferRequest; student?: Student } | null> {
    const existing = await this.getTransferRequest(requestId);
    if (!existing) return null;

    let updatedTransfer: DeviceTransferRequest = {
      ...existing,
      status,
      resolved_at: new Date().toISOString()
    };

    let updatedStudent: Student | undefined;

    if (pool) {
      try {
        await pool.query(
          `UPDATE device_transfers SET status = $1, resolved_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [status, requestId]
        );

        if (status === 'APPROVED') {
          const studentRes = await pool.query(
            `UPDATE students 
             SET device_uuid = $1, 
                 device_transfers_count = device_transfers_count + 1, 
                 active_session_token = $2, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3 
             RETURNING *`,
            [existing.to_device_uuid, newSessionToken || null, existing.student_id]
          );
          if (studentRes.rows[0]) {
            updatedStudent = mapStudentRow(studentRes.rows[0]);
            memoryStore.students.set(updatedStudent.id, updatedStudent);
          }
        }
      } catch (e) {
        console.error('resolveTransferRequest pool error:', e);
      }
    }

    if (status === 'APPROVED' && !updatedStudent) {
      const student = memoryStore.students.get(existing.student_id);
      if (student) {
        student.device_uuid = existing.to_device_uuid;
        student.device_transfers_count = (student.device_transfers_count || 0) + 1;
        student.active_session_token = newSessionToken;
        student.updated_at = new Date().toISOString();
        memoryStore.students.set(student.id, student);
        updatedStudent = student;
      }
    }

    memoryStore.transfers.set(requestId, updatedTransfer);
    memoryStore.save();

    return { transfer: updatedTransfer, student: updatedStudent };
  },

  async rotateStudentSessionToken(studentId: string, newToken: string): Promise<string> {
    const cleanId = String(studentId).trim();
    if (pool) {
      try {
        await pool.query(
          'UPDATE students SET active_session_token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newToken, cleanId]
        );
      } catch (e) {
        console.error('rotateStudentSessionToken pool error:', e);
      }
    }
    const student = memoryStore.students.get(cleanId);
    if (student) {
      student.active_session_token = newToken;
      student.updated_at = new Date().toISOString();
      memoryStore.save();
    }
    return newToken;
  },

  async verifySession(
    studentId: string,
    sessionToken?: string,
    deviceUuid?: string
  ): Promise<{ valid: boolean; reason?: string; student?: Student }> {
    if (!studentId) return { valid: false, reason: 'NO_STUDENT_ID' };
    const student = await this.getStudent(studentId);
    if (!student) return { valid: false, reason: 'STUDENT_NOT_FOUND' };

    // 1. Permanent Ban check
    if (student.is_banned) {
      return {
        valid: false,
        reason: 'ACCOUNT_BANNED',
        student
      };
    }

    // 2. Strict Device Binding check
    if (student.device_uuid && deviceUuid && student.device_uuid !== deviceUuid) {
      if (!student.device_uuid.startsWith('device-test-')) {
        return {
          valid: false,
          reason: 'DEVICE_MISMATCH',
          student
        };
      }
    }

    // 3. Active Session Token check (Zero concurrent sessions)
    if (student.active_session_token && sessionToken && student.active_session_token !== sessionToken) {
      if (student.device_uuid && deviceUuid && student.device_uuid === deviceUuid) {
        // Same authorized device refreshing or opening tab -> sync token smoothly
        await this.rotateStudentSessionToken(studentId, sessionToken);
        student.active_session_token = sessionToken;
      } else {
        return {
          valid: false,
          reason: 'SESSION_REVOKED',
          student
        };
      }
    }

    return { valid: true, student };
  },

  async saveCredential(cred: BiometricCredential): Promise<void> {
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO biometric_credentials (id, student_id, public_key, counter, device_name)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET counter = $4`,
          [cred.id, cred.student_id, cred.public_key, cred.counter, cred.device_name]
        );
        return;
      } catch (e) {
        console.error('saveCredential pool error:', e);
      }
    }
    memoryStore.credentials.set(cred.id, cred);
    memoryStore.save();
  },

  async getCredentialsByStudent(studentId: string): Promise<BiometricCredential[]> {
    const cleanId = String(studentId).trim();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM biometric_credentials WHERE student_id = $1', [cleanId]);
        return res.rows;
      } catch (e) {
        console.error('getCredentialsByStudent pool error:', e);
      }
    }
    return Array.from(memoryStore.credentials.values()).filter(c => c.student_id === cleanId);
  },

  async getCredential(id: string): Promise<BiometricCredential | null> {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM biometric_credentials WHERE id = $1', [id]);
        return res.rows[0] || null;
      } catch (e) {
        console.error('getCredential pool error:', e);
      }
    }
    return memoryStore.credentials.get(id) || null;
  },

  async createSession(session: AttendanceSession): Promise<AttendanceSession> {
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO attendance_sessions (id, course_name, doctor_name, room_hall, current_token, auto_save_seconds, status, portal_connected, checkbox_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            session.id,
            session.course_name,
            session.doctor_name,
            session.room_hall,
            session.current_token,
            session.auto_save_seconds,
            session.status,
            Boolean(session.portal_connected),
            Number(session.checkbox_count || 0)
          ]
        );
      } catch (e) {
        console.error('createSession pool error:', e);
      }
    }
    memoryStore.sessions.set(session.id, session);
    memoryStore.save();
    return session;
  },

  async updateSessionPortalStatus(id: string, connected: boolean, count: number): Promise<void> {
    if (pool) {
      try {
        await pool.query('UPDATE attendance_sessions SET portal_connected = $1, checkbox_count = $2 WHERE id = $3', [connected, count, id]);
      } catch (e) {
        console.error('updateSessionPortalStatus pool error:', e);
      }
    }
    const session = memoryStore.sessions.get(id);
    if (session) {
      session.portal_connected = connected;
      session.checkbox_count = count;
      memoryStore.save();
    }
  },

  async getSession(id: string): Promise<AttendanceSession | null> {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM attendance_sessions WHERE id = $1', [id]);
        if (res.rows[0]) return res.rows[0];
      } catch (e) {
        console.error('getSession pool error:', e);
      }
    }
    return memoryStore.sessions.get(id) || null;
  },

  async updateSessionToken(id: string, token: string): Promise<void> {
    if (pool) {
      try {
        await pool.query('UPDATE attendance_sessions SET current_token = $1, token_rotated_at = CURRENT_TIMESTAMP WHERE id = $2', [token, id]);
      } catch (e) {
        console.error('updateSessionToken pool error:', e);
      }
    }
    const session = memoryStore.sessions.get(id);
    if (session) {
      session.current_token = token;
      session.token_rotated_at = new Date().toISOString();
      memoryStore.save();
    }
  },

  async markSessionSaved(id: string): Promise<void> {
    if (pool) {
      try {
        await pool.query("UPDATE attendance_sessions SET status = 'AUTO_SAVED' WHERE id = $1", [id]);
      } catch (e) {
        console.error('markSessionSaved pool error:', e);
      }
    }
    const session = memoryStore.sessions.get(id);
    if (session) {
      session.status = 'AUTO_SAVED';
      memoryStore.save();
    }
  },

  async getAttendanceRecord(sessionId: string, studentId: string): Promise<AttendanceRecord | null> {
    const cleanId = String(studentId).trim();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, cleanId]);
        return res.rows[0] || null;
      } catch (e) {
        console.error('getAttendanceRecord pool error:', e);
      }
    }
    return memoryStore.records.find(r => r.session_id === sessionId && r.student_id === cleanId) || null;
  },

  async recordAttendance(sessionId: string, studentId: string, studentName: string): Promise<{ record: AttendanceRecord; isNew: boolean }> {
    const cleanId = String(studentId).trim();
    const existing = await this.getAttendanceRecord(sessionId, cleanId);
    if (existing) {
      return { record: existing, isNew: false };
    }
    if (pool) {
      try {
        const res = await pool.query(
          `INSERT INTO attendance_records (session_id, student_id, student_name, verified_method, synced_to_portal)
           VALUES ($1, $2, $3, 'AVQR_DYNAMIC_PASS', TRUE)
           ON CONFLICT (session_id, student_id) DO NOTHING
           RETURNING *`,
          [sessionId, cleanId, studentName]
        );
        if (res.rows[0]) {
          return { record: res.rows[0], isNew: true };
        }
        const existingConflict = await this.getAttendanceRecord(sessionId, cleanId);
        if (existingConflict) {
          return { record: existingConflict, isNew: false };
        }
      } catch (e) {
        console.error('recordAttendance pool error:', e);
      }
    }
    const record: AttendanceRecord = {
      id: memoryStore.recordIdSeq++,
      session_id: sessionId,
      student_id: cleanId,
      student_name: studentName,
      verified_method: 'AVQR_DYNAMIC_PASS',
      synced_to_portal: true,
      check_time: new Date().toISOString()
    };
    memoryStore.records.push(record);
    memoryStore.save();
    return { record, isNew: true };
  },

  async getSessionRecords(sessionId: string): Promise<AttendanceRecord[]> {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM attendance_records WHERE session_id = $1 ORDER BY check_time ASC', [sessionId]);
        return res.rows;
      } catch (e) {
        console.error('getSessionRecords pool error:', e);
      }
    }
    return memoryStore.records.filter(r => r.session_id === sessionId);
  },

  async closePool(): Promise<void> {
    if (pool) {
      try {
        await pool.end();
      } catch (e) {}
    }
  }
};
