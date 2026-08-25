import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index';
import { sql } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';

export async function runMigrations() {
  console.log('[Database] Checking & applying database migrations...');
  const candidates = [
    path.resolve(__dirname, '../../drizzle'),
    path.resolve(__dirname, '../drizzle'),
    path.resolve(process.cwd(), 'apps/backend/drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];

  const migrationsFolder = candidates.find((p) => fs.existsSync(p));
  if (!migrationsFolder) {
    console.warn('[Database] ⚠️ Migrations folder not found. Candidate paths checked:', candidates);
    return;
  }

  try {
    // 1. Run the Drizzle migrator first (creates base tables if they don't exist in Supabase)
    await migrate(db, { migrationsFolder });
    console.log(`[Database] ✅ Migrations successfully applied from: ${migrationsFolder}`);

    // 2. Run Safe Schema Evolution next (adds evolutionary lobby/timer columns/tables if missing)
    await db.execute(sql`
      ALTER TABLE contests
        ADD COLUMN IF NOT EXISTS lobby_started_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS lobby_duration_ms INTEGER DEFAULT 900000
    `);
    await db.execute(sql`
      ALTER TABLE teams
        ADD COLUMN IF NOT EXISTS freeze_ends_at TIMESTAMP
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "spider_sense_challenges" (
        "id" text PRIMARY KEY NOT NULL,
        "team_id" text NOT NULL,
        "problem_id" text NOT NULL,
        "question_ids" json NOT NULL,
        "correct_indices" json NOT NULL,
        "options_list" json NOT NULL,
        "attempt_count" integer DEFAULT 0 NOT NULL,
        "completed_questions" integer DEFAULT 0 NOT NULL,
        "is_completed" boolean DEFAULT false NOT NULL,
        "is_consumed" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp
      )
    `);
    console.log('[Database] ✅ Safe schema evolution completed.');
  } catch (err: any) {
    console.error('[Database] ❌ Migration error:', err.message);
  }
}
