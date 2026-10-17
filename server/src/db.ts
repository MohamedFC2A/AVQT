import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Neon PostgreSQL connection or in-memory fallback for ultra-resilience
const DATABASE_URL = process.env.DATABASE_URL;

export interface Student {
  id: string; // e.g. "20264712"
  full_name: string;
  faculty: string;
  level: string;
  password_hash?: string;
  card_verified: boolean;
  card_ss_uuid?: string;
  card_verified_at?: string;
  created_at: string;
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

import fs from 'fs';
import path from 'path';

const PERSIST_FILE = process.env.VERCEL ? '/tmp/avqr_db_state.json' : path.resolve(process.cwd(), 'avqr_db_state.json');

// In-Memory store as zero-failure fallback with disk persistence
class MemoryStore {
  students: Map<string, Student> = new Map();
  credentials: Map<string, BiometricCredential> = new Map();
  sessions: Map<string, AttendanceSession> = new Map();
  records: AttendanceRecord[] = [];
  recordIdSeq = 1;

  constructor() {
    this.load();
    // Ensure default verified student for Mohamed Matany always exists
    if (!this.students.has('20264712')) {
      this.students.set('20264712', {
        id: '20264712',
        full_name: 'Mohamed Ahmed Mohamed Matany Ahmed',
        faculty: 'Engineering',
        level: '1-First',
        card_verified: true,
        card_ss_uuid: 'cc011cc7-ceb7-4867-973a-79d0a44e5214',
        card_verified_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      });
      this.save();
    }
  }

  save() {
    try {
      const data = {
        students: Array.from(this.students.entries()),
        credentials: Array.from(this.credentials.entries()),
        sessions: Array.from(this.sessions.entries()),
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
      ssl: { rejectUnauthorized: false }
    });
    console.log('[Neon.tech] Connected to PostgreSQL Serverless cluster');
  } catch (err) {
    console.warn('[Neon.tech] Connection init failed, using MemoryStore fallback:', err);
    pool = null;
  }
} else {
  console.log('[Database] Running in MemoryStore mode (Deep resilience & zero downtime)');
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
        password_hash VARCHAR(255),
        card_verified BOOLEAN DEFAULT FALSE,
        card_ss_uuid VARCHAR(255),
        card_verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
    console.log('[Neon.tech] Schema verified and ready');
  } catch (error) {
    console.error('Database migration check failed:', error);
  }
}

// Database Abstraction API
export const db = {
  async getStudent(id: string): Promise<Student | null> {
    if (pool) {
      const res = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return memoryStore.students.get(id) || null;
  },

  async upsertStudent(student: Partial<Student> & { id: string }): Promise<Student> {
    if (pool) {
      const existing = await this.getStudent(student.id);
      if (existing) {
        const updated = { ...existing, ...student };
        await pool.query(
          `UPDATE students SET full_name = $1, faculty = $2, level = $3, 
           password_hash = COALESCE($4, password_hash), card_verified = $5, 
           card_ss_uuid = $6, card_verified_at = $7 WHERE id = $8`,
          [
            updated.full_name,
            updated.faculty || 'Engineering',
            updated.level || '1-First',
            student.password_hash || null,
            updated.card_verified,
            updated.card_ss_uuid || null,
            updated.card_verified_at || null,
            student.id
          ]
        );
        return updated;
      } else {
        const newStudent: Student = {
          id: student.id,
          full_name: student.full_name || `Student ${student.id}`,
          faculty: student.faculty || 'Engineering',
          level: student.level || '1-First',
          password_hash: student.password_hash,
          card_verified: student.card_verified || false,
          card_ss_uuid: student.card_ss_uuid,
          card_verified_at: student.card_verified_at,
          created_at: new Date().toISOString()
        };
        await pool.query(
          `INSERT INTO students (id, full_name, faculty, level, password_hash, card_verified, card_ss_uuid, card_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            newStudent.id,
            newStudent.full_name,
            newStudent.faculty,
            newStudent.level,
            newStudent.password_hash || null,
            newStudent.card_verified,
            newStudent.card_ss_uuid || null,
            newStudent.card_verified_at || null
          ]
        );
        return newStudent;
      }
    }

    const existing = memoryStore.students.get(student.id);
    const updated: Student = {
      id: student.id,
      full_name: student.full_name || existing?.full_name || `Student ${student.id}`,
      faculty: student.faculty || existing?.faculty || 'Engineering',
      level: student.level || existing?.level || '1-First',
      password_hash: student.password_hash || existing?.password_hash,
      card_verified: student.card_verified !== undefined ? student.card_verified : (existing?.card_verified ?? false),
      card_ss_uuid: student.card_ss_uuid || existing?.card_ss_uuid,
      card_verified_at: student.card_verified_at || existing?.card_verified_at,
      created_at: existing?.created_at || new Date().toISOString()
    };
    memoryStore.students.set(student.id, updated);
    memoryStore.save();
    return updated;
  },

  async saveCredential(cred: BiometricCredential): Promise<void> {
    if (pool) {
      await pool.query(
        `INSERT INTO biometric_credentials (id, student_id, public_key, counter, device_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET counter = $4`,
        [cred.id, cred.student_id, cred.public_key, cred.counter, cred.device_name]
      );
      return;
    }
    memoryStore.credentials.set(cred.id, cred);
    memoryStore.save();
  },

  async getCredentialsByStudent(studentId: string): Promise<BiometricCredential[]> {
    if (pool) {
      const res = await pool.query('SELECT * FROM biometric_credentials WHERE student_id = $1', [studentId]);
      return res.rows;
    }
    return Array.from(memoryStore.credentials.values()).filter(c => c.student_id === studentId);
  },

  async getCredential(id: string): Promise<BiometricCredential | null> {
    if (pool) {
      const res = await pool.query('SELECT * FROM biometric_credentials WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return memoryStore.credentials.get(id) || null;
  },

  async createSession(session: AttendanceSession): Promise<AttendanceSession> {
    if (pool) {
      await pool.query(
        `INSERT INTO attendance_sessions (id, course_name, doctor_name, room_hall, current_token, auto_save_seconds, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [session.id, session.course_name, session.doctor_name, session.room_hall, session.current_token, session.auto_save_seconds, session.status]
      );
      return session;
    }
    memoryStore.sessions.set(session.id, session);
    memoryStore.save();
    return session;
  },

  async getSession(id: string): Promise<AttendanceSession | null> {
    if (pool) {
      const res = await pool.query('SELECT * FROM attendance_sessions WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return memoryStore.sessions.get(id) || null;
  },

  async updateSessionToken(id: string, token: string): Promise<void> {
    if (pool) {
      await pool.query('UPDATE attendance_sessions SET current_token = $1, token_rotated_at = CURRENT_TIMESTAMP WHERE id = $2', [token, id]);
      return;
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
      await pool.query("UPDATE attendance_sessions SET status = 'AUTO_SAVED' WHERE id = $1", [id]);
      return;
    }
    const session = memoryStore.sessions.get(id);
    if (session) {
      session.status = 'AUTO_SAVED';
      memoryStore.save();
    }
  },

  async recordAttendance(sessionId: string, studentId: string, studentName: string): Promise<AttendanceRecord> {
    if (pool) {
      const res = await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, student_name, verified_method, synced_to_portal)
         VALUES ($1, $2, $3, 'AVQR_DYNAMIC_PASS', TRUE)
         ON CONFLICT (session_id, student_id) DO UPDATE SET check_time = CURRENT_TIMESTAMP
         RETURNING *`,
        [sessionId, studentId, studentName]
      );
      return res.rows[0];
    }
    const existing = memoryStore.records.find(r => r.session_id === sessionId && r.student_id === studentId);
    if (existing) {
      existing.check_time = new Date().toISOString();
      memoryStore.save();
      return existing;
    }
    const record: AttendanceRecord = {
      id: memoryStore.recordIdSeq++,
      session_id: sessionId,
      student_id: studentId,
      student_name: studentName,
      verified_method: 'AVQR_DYNAMIC_PASS',
      synced_to_portal: true,
      check_time: new Date().toISOString()
    };
    memoryStore.records.push(record);
    memoryStore.save();
    return record;
  },

  async getSessionRecords(sessionId: string): Promise<AttendanceRecord[]> {
    if (pool) {
      const res = await pool.query('SELECT * FROM attendance_records WHERE session_id = $1 ORDER BY check_time ASC', [sessionId]);
      return res.rows;
    }
    return memoryStore.records.filter(r => r.session_id === sessionId);
  }
};
