import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  const raw = fs.readFileSync('server/avqr_db_state.json', 'utf-8');
  const state = JSON.parse(raw);
  for (const [id, s] of state.students) {
    await pool.query(
      `INSERT INTO students (id, full_name, faculty, level, card_verified, card_ss_uuid, card_verified_at, device_uuid, emergency_access_key, device_transfers_count, is_banned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, FALSE)
       ON CONFLICT (id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         card_verified = EXCLUDED.card_verified,
         card_ss_uuid = EXCLUDED.card_ss_uuid,
         emergency_access_key = EXCLUDED.emergency_access_key`,
      [s.id, s.full_name, s.faculty || 'Engineering', s.level || '1-First', s.card_verified ?? false, s.card_ss_uuid || null, s.card_verified_at || null, s.device_uuid || null, s.emergency_access_key || null]
    );
    console.log('Seeded student:', s.id, s.full_name);
  }

  // Also seed sessions if any
  for (const [sid, sess] of state.sessions) {
    await pool.query(
      `INSERT INTO attendance_sessions (id, course_name, doctor_name, room_hall, current_token, auto_save_seconds, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [sess.id, sess.course_name, sess.doctor_name, sess.room_hall, sess.current_token, sess.auto_save_seconds || 180, sess.status || 'ACTIVE']
    );
    console.log('Seeded session:', sid);
  }

  console.log('Migration to Neon complete!');
  await pool.end();
}

seed().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
