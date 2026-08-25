import '../src/config/env';
import { db, client as pgClient } from '../src/db';
import { connection as redisConnection } from '../src/config/redis';
import { contests, teams, problems, submissions, teamWorkspaces, teamPowerups, violations, spiderSenseChallenges } from '../src/db/schema';
import { calculateLeaderboard } from '../src/utils/leaderboard';
import { verifySchema } from '../src/db/migrate';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('[Verify DB] Starting automated production database verification...');
  let failed = false;

  // 1. PostgreSQL connection
  try {
    await db.execute(sql`SELECT 1`);
    console.log('[Verify DB] ✅ 1. PostgreSQL connection: OK');
  } catch (err: any) {
    console.error('[Verify DB] ❌ 1. PostgreSQL connection: FAILED -', err.message);
    failed = true;
  }

  // 2 & 3. Required tables & columns
  try {
    const schemaAudit = await verifySchema();
    if (schemaAudit.ok) {
      console.log('[Verify DB] ✅ 2 & 3. Required tables and columns: OK');
    } else {
      console.error('[Verify DB] ❌ 2 & 3. Required tables and columns: FAILED - Missing:', schemaAudit.missing.join(', '));
      failed = true;
    }
  } catch (err: any) {
    console.error('[Verify DB] ❌ 2 & 3. Schema verification error:', err.message);
    failed = true;
  }

  // 4. Migration state
  try {
    const migrationsRes: any = await db.execute(sql`
      SELECT count(*) FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
    `);
    if (migrationsRes && migrationsRes.length > 0) {
      console.log('[Verify DB] ✅ 4. Migration state: OK');
    } else {
      console.error('[Verify DB] ❌ 4. Migration table check: FAILED');
      failed = true;
    }
  } catch (err: any) {
    console.error('[Verify DB] ❌ 4. Migration check error:', err.message);
    failed = true;
  }

  // 5. Problem count
  try {
    const allProblems = await db.select().from(problems);
    console.log(`[Verify DB] ✅ 5. Problem count: OK (${allProblems.length} problems loaded)`);
    if (allProblems.length === 0) {
      console.warn('[Verify DB] ⚠️ 5. Warning: 0 problems found in database');
    }
  } catch (err: any) {
    console.error('[Verify DB] ❌ 5. Problem query: FAILED -', err.message);
    failed = true;
  }

  // 6. Team count
  try {
    const allTeams = await db.select().from(teams);
    console.log(`[Verify DB] ✅ 6. Team count: OK (${allTeams.length} teams registered)`);
  } catch (err: any) {
    console.error('[Verify DB] ❌ 6. Team query: FAILED -', err.message);
    failed = true;
  }

  // 7. Contest existence
  try {
    const allContests = await db.select().from(contests);
    console.log(`[Verify DB] ✅ 7. Contest existence: OK (${allContests.length} contest records found)`);
  } catch (err: any) {
    console.error('[Verify DB] ❌ 7. Contest query: FAILED -', err.message);
    failed = true;
  }

  // 8. Redis connection
  try {
    const pingRes = await redisConnection.ping();
    if (pingRes === 'PONG') {
      console.log('[Verify DB] ✅ 8. Redis connection: OK (PONG)');
    } else {
      console.error('[Verify DB] ❌ 8. Redis ping returned unexpected response:', pingRes);
      failed = true;
    }
  } catch (err: any) {
    console.error('[Verify DB] ❌ 8. Redis connection: FAILED -', err.message);
    failed = true;
  }

  // 9. Basic leaderboard query
  try {
    const leaderboard = await calculateLeaderboard(db);
    console.log(`[Verify DB] ✅ 9. Leaderboard calculation: OK (${leaderboard.length} entries calculated)`);
  } catch (err: any) {
    console.error('[Verify DB] ❌ 9. Leaderboard query: FAILED -', err.message);
    failed = true;
  }

  // 10. Basic submission query
  try {
    const sampleSub = await db.select().from(submissions).limit(1);
    console.log('[Verify DB] ✅ 10. Submission query: OK');
  } catch (err: any) {
    console.error('[Verify DB] ❌ 10. Submission query: FAILED -', err.message);
    failed = true;
  }

  // Cleanup connections
  await redisConnection.quit().catch(() => {});
  await pgClient.end().catch(() => {});

  if (failed) {
    console.error('\n[Verify DB] ❌ Verification FAILED. Please inspect errors above.');
    process.exit(1);
  } else {
    console.log('\n[Verify DB] 🎉 All 10 verification checks PASSED successfully!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Verify DB] Fatal error during verification:', err);
  process.exit(1);
});
