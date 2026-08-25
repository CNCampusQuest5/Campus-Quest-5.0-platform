import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index';
import { sql } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';

export function logSafePgError(prefix: string, err: any) {
  console.error(`${prefix} Database operation failed.`);
  if (err?.code) console.error(`${prefix} PostgreSQL code=${err.code}`);
  if (err?.cause?.code) console.error(`${prefix} Underlying cause code=${err.cause.code}`);
  if (err?.cause?.message) {
    const safeCause = String(err.cause.message).replace(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@/g, 'postgres://$1:***@');
    console.error(`${prefix} Underlying cause message=${safeCause}`);
  }
  if (err?.message) {
    const safeMsg = String(err.message).replace(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@/g, 'postgres://$1:***@');
    console.error(`${prefix} PostgreSQL message=${safeMsg}`);
  }
  if (err?.detail) {
    const safeDetail = String(err.detail).replace(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@/g, 'postgres://$1:***@');
    console.error(`${prefix} PostgreSQL detail=${safeDetail}`);
  }
  if (err?.hint) {
    console.error(`${prefix} PostgreSQL hint=${err.hint}`);
  }
}

export async function verifySchema(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  const requiredTables = [
    'contests', 'teams', 'problems', 'submissions',
    'team_workspaces', 'team_powerups', 'violations', 'spider_sense_challenges'
  ];

  for (const table of requiredTables) {
    try {
      const res: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = ${table}
      `);
      if (!res || res.length === 0) {
        missing.push(`Table: ${table}`);
      }
    } catch (err: any) {
      missing.push(`Table check failed for ${table}: ${err.message}`);
    }
  }

  const requiredColumns = [
    { table: 'contests', column: 'lobby_started_at' },
    { table: 'contests', column: 'lobby_duration_ms' },
    { table: 'teams', column: 'freeze_ends_at' },
    { table: 'team_workspaces', column: 'last_client_update' },
  ];

  for (const item of requiredColumns) {
    try {
      const res: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = ${item.table} AND column_name = ${item.column}
      `);
      if (!res || res.length === 0) {
        missing.push(`Column: ${item.table}.${item.column}`);
      }
    } catch (err: any) {
      missing.push(`Column check failed for ${item.table}.${item.column}: ${err.message}`);
    }
  }

  return { ok: missing.length === 0, missing };
}

export async function runMigrations(): Promise<boolean> {
  console.log('[Database] Checking & applying database migrations...');

  // 1. Verify basic connection first
  try {
    await db.execute(sql`SELECT 1`);
    console.log('[Database] PostgreSQL connection established.');
  } catch (err: any) {
    logSafePgError('[Database]', err);
    return false;
  }

  const candidates = [
    path.resolve(__dirname, '../../drizzle'),
    path.resolve(__dirname, '../drizzle'),
    path.resolve(process.cwd(), 'apps/backend/drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];

  const migrationsFolder = candidates.find((p) => fs.existsSync(p));

  if (migrationsFolder) {
    try {
      await migrate(db, { 
        migrationsFolder,
        migrationsSchema: 'public'
      });
      console.log(`[Database] ✅ Drizzle migrator successfully applied from: ${migrationsFolder}`);
    } catch (err: any) {
      logSafePgError('[Database] Drizzle migrator notice:', err);
      console.log('[Database] Falling back to safe idempotent DDL runner...');
    }
  } else {
    console.warn('[Database] ⚠️ Migrations folder not found. Candidate paths checked:', candidates);
  }

  // 2. Safe Idempotent Schema Evolution Runner
  // Ensures all ENUMs, Tables, Columns, and Indexes defined in current schema exist without throwing DDL permission errors
  try {
    // ENUMs
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."contest_status" AS ENUM('NOT_STARTED', 'LOBBY', 'RUNNING', 'PAUSED', 'ENDED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."language" AS ENUM('C', 'CPP', 'PYTHON', 'JAVA');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."powerup_type" AS ENUM('SPIDER_SENSE', 'WEB_FLUID', 'SUIT_TECH');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."submission_status" AS ENUM('PENDING', 'JUDGING', 'DONE');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."verdict" AS ENUM('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'BYPASSED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."violation_type" AS ENUM('TAB_SWITCH', 'BLUR', 'FULLSCREEN_EXIT', 'DEVTOOLS_ATTEMPT', 'COPY_PASTE');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "teams" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "violation_count" integer DEFAULT 0 NOT NULL,
        "is_disqualified" boolean DEFAULT false NOT NULL,
        "is_paused" boolean DEFAULT false NOT NULL,
        "spider_sense_charges" integer DEFAULT 1 NOT NULL,
        "hint_stage" integer DEFAULT 0 NOT NULL,
        "freeze_ends_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "contests" (
        "id" text PRIMARY KEY NOT NULL,
        "status" "public"."contest_status" DEFAULT 'NOT_STARTED' NOT NULL,
        "started_at" timestamp,
        "paused_at" timestamp,
        "total_paused_ms" integer DEFAULT 0 NOT NULL,
        "duration_ms" integer NOT NULL,
        "ends_at" timestamp,
        "lobby_started_at" timestamp,
        "lobby_duration_ms" integer DEFAULT 900000
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "problems" (
        "id" text PRIMARY KEY NOT NULL,
        "title" text NOT NULL,
        "statement" text NOT NULL,
        "order" integer NOT NULL,
        "time_limit_ms" integer DEFAULT 2000 NOT NULL,
        "memory_limit_mb" integer DEFAULT 256 NOT NULL,
        "test_cases" json NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "submissions" (
        "id" text PRIMARY KEY NOT NULL,
        "team_id" text NOT NULL REFERENCES "public"."teams"("id") ON DELETE CASCADE,
        "problem_id" text NOT NULL REFERENCES "public"."problems"("id") ON DELETE CASCADE,
        "language" "public"."language" NOT NULL,
        "source_code" text NOT NULL,
        "status" "public"."submission_status" DEFAULT 'PENDING' NOT NULL,
        "verdict" "public"."verdict",
        "runtime_ms" integer,
        "memory_kb" integer,
        "test_case_results" json,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "judged_at" timestamp
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "violations" (
        "id" text PRIMARY KEY NOT NULL,
        "team_id" text NOT NULL REFERENCES "public"."teams"("id") ON DELETE CASCADE,
        "type" "public"."violation_type" NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "team_powerups" (
        "id" text PRIMARY KEY NOT NULL,
        "team_id" text NOT NULL REFERENCES "public"."teams"("id") ON DELETE CASCADE,
        "type" "public"."powerup_type" NOT NULL,
        "used_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "team_workspaces" (
        "id" text PRIMARY KEY NOT NULL,
        "team_id" text NOT NULL REFERENCES "public"."teams"("id") ON DELETE CASCADE,
        "problem_id" text NOT NULL REFERENCES "public"."problems"("id") ON DELETE CASCADE,
        "language" "public"."language" NOT NULL,
        "source_code" text NOT NULL,
        "cursor_line" integer DEFAULT 1 NOT NULL,
        "cursor_column" integer DEFAULT 1 NOT NULL,
        "scroll_position" integer DEFAULT 0 NOT NULL,
        "last_client_update" bigint DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "spider_sense_challenges" (
        "id" text PRIMARY KEY NOT NULL,
        "team_id" text NOT NULL REFERENCES "public"."teams"("id") ON DELETE CASCADE,
        "problem_id" text NOT NULL REFERENCES "public"."problems"("id") ON DELETE CASCADE,
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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    // Column evolution safeguards
    await db.execute(sql`ALTER TABLE contests ADD COLUMN IF NOT EXISTS lobby_started_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE contests ADD COLUMN IF NOT EXISTS lobby_duration_ms INTEGER DEFAULT 900000`);
    await db.execute(sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS freeze_ends_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE team_workspaces ADD COLUMN IF NOT EXISTS last_client_update BIGINT DEFAULT 0`);

    // Indexes
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "problems_order_idx" ON "problems" ("order")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "submissions_team_id_idx" ON "submissions" ("team_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "submissions_problem_id_idx" ON "submissions" ("problem_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "submissions_verdict_idx" ON "submissions" ("verdict")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "submissions_created_at_idx" ON "submissions" ("created_at")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "violations_team_id_idx" ON "violations" ("team_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "team_powerups_team_id_idx" ON "team_powerups" ("team_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "team_workspaces_team_id_problem_id_idx" ON "team_workspaces" ("team_id", "problem_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "spider_sense_challenges_team_id_idx" ON "spider_sense_challenges" ("team_id")`);

    console.log('[Database] ✅ Schema DDL verification/execution finished.');
  } catch (err: any) {
    logSafePgError('[Database] ❌ Safe Schema Evolution error:', err);
  }

  // 3. Final audit verification
  const audit = await verifySchema();
  if (audit.ok) {
    console.log('[Database] ✅ Schema verification passed. All required tables & columns exist.');
    return true;
  } else {
    console.error('[Database] ❌ Schema verification failed. Missing entities:', audit.missing.join(', '));
    return false;
  }
}
