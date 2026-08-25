import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { teams, contests, problems, submissions, teamPowerups, violations } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { calculateLeaderboard, broadcastLeaderboard } from '../utils/leaderboard';
import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';

export const ADMIN_SECRET = process.env.ADMIN_SECRET || 'spidey_admin_2024';
export const JWT_SECRET = process.env.JWT_SECRET || 'campus_quest_jwt_secret_key_2024';

// ── Test / Dev login credentials ──────────────────────────────────────────────
// These are inserted into the DB on backend start via seedTestTeams().
// Password is stored in plain text here ONLY for demo/dev purposes.
export const TEST_TEAMS = [
  { id: 'test-team-alpha',     name: 'Spider Squad',       email: 'spider@test.cq',     password: 'spider123' },
  { id: 'test-team-beta',      name: 'Iron Coders',        email: 'iron@test.cq',       password: 'iron456' },
  { id: 'test-team-gamma',     name: 'Web Slingers',       email: 'web@test.cq',        password: 'web789' },
  { id: 'test-team-delta',     name: 'Quantum Devs',       email: 'quantum@test.cq',    password: 'quantum000' },
  { id: 'test-team-epsilon',   name: 'Cyber Spiders',      email: 'cyber@test.cq',      password: 'cyber101' },
  { id: 'test-team-zeta',      name: 'Venom Bytes',        email: 'venom@test.cq',      password: 'venom2024' },
  { id: 'test-team-eta',       name: 'Glitch Hackers',     email: 'glitch@test.cq',     password: 'glitch505' },
  { id: 'test-team-theta',     name: 'Prowler Protocol',   email: 'prowler@test.cq',    password: 'prowler77' },
  { id: 'test-team-iota',      name: 'Multiverse Ninjas',  email: 'multiverse@test.cq', password: 'multiverse99' },
  { id: 'test-team-kappa',     name: 'Oscorp Engineers',   email: 'oscorp@test.cq',     password: 'oscorp321' },
  { id: 'test-team-lambda',    name: 'Symbiote Script',    email: 'symbiote@test.cq',   password: 'symbiote11' },
  { id: 'test-team-mu',        name: 'Daily Bugle Devs',   email: 'bugle@test.cq',      password: 'bugle2026' },
  { id: 'test-team-nu',        name: 'Sinister Coders',    email: 'sinister@test.cq',   password: 'sinister6' },
  { id: 'test-team-xi',        name: 'Stark Industries',   email: 'stark@test.cq',      password: 'stark3000' },
  { id: 'test-team-omicron',   name: 'Web Warriors',       email: 'warriors@test.cq',   password: 'warriors88' },
  { id: 'test-team-pi',        name: 'Electro Algorithms', email: 'electro@test.cq',    password: 'electro100' },
  { id: 'test-team-rho',       name: 'Goblin Innovators',  email: 'goblin@test.cq',     password: 'goblin200' },
  { id: 'test-team-sigma',     name: 'Rhino Compilers',    email: 'rhino@test.cq',      password: 'rhino300' },
  { id: 'test-team-tau',       name: 'Mysterio Coders',    email: 'mysterio@test.cq',   password: 'mysterio400' },
  { id: 'test-team-upsilon',   name: 'Kraven Hackers',     email: 'kraven@test.cq',     password: 'kraven500' },
  { id: 'test-team-phi',       name: 'Lizard Logic',       email: 'lizard@test.cq',     password: 'lizard600' },
  { id: 'test-team-chi',       name: 'Sandman Script',     email: 'sandman@test.cq',    password: 'sandman700' },
  { id: 'test-team-psi',       name: 'Vulture Vector',     email: 'vulture@test.cq',    password: 'vulture800' },
  { id: 'test-team-omega',     name: 'Carnage Bytes',      email: 'carnage@test.cq',    password: 'carnage900' },
  { id: 'test-team-25',        name: 'Kingpin Coders',     email: 'kingpin@test.cq',    password: 'kingpin999' },
];

// Seed test teams into DB on startup (idempotent)
export async function seedTestTeams() {
  for (const t of TEST_TEAMS) {
    const existing = await db.select().from(teams).where(eq(teams.id, t.id));
    if (existing.length === 0) {
      await db.insert(teams).values({
        id: t.id,
        name: t.name,
        email: t.email,
        passwordHash: t.password, // plain text for dev
        violationCount: 0,
        isDisqualified: false,
        isPaused: false,
        spiderSenseCharges: 1,
        hintStage: 0,
      }).onConflictDoNothing();
      console.log(`[Seed] Created test team: ${t.name} (${t.id})`);
    }
  }
}

export default async function adminRoutes(fastify: FastifyInstance) {
  // ── Admin Login — validate ADMIN_SECRET, return it as a bearer token ─────────
  // This is the entry point for the admin panel login form.
  fastify.post('/admin/login', async (request, reply) => {
    const { secret } = request.body as { secret?: string };
    if (!secret || secret !== ADMIN_SECRET) {
      return reply.code(401).send({ error: 'INVALID_SECRET', message: 'Invalid admin secret.' });
    }
    // Return the secret itself as the bearer token (stateless, no JWT needed for admin)
    return { success: true, token: secret };
  });

  // ── Admin Auth Middleware — enforces 401 on all /admin/* routes ──────────────
  fastify.addHook('preHandler', async (request, reply) => {
    // Only protect /admin/* paths (leave /api/* open for contest logic)
    if (!request.url.startsWith('/admin/')) return;
    // /admin/login itself is exempt
    if (request.url === '/admin/login') return;

    const authHeader = request.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${ADMIN_SECRET}`) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Valid admin secret required.' });
    }
  });

  // 0. Get Contest Status
  fastify.get('/admin/contest-status', async (_request, _reply) => {
    const allContests = await db.select().from(contests);
    if (allContests.length === 0) {
      return { status: 'NOT_STARTED' };
    }
    return allContests[0];
  });

  // 1. Start Global Contest
  fastify.post('/admin/start-contest', async (_request, _reply) => {
    const allContests = await db.select().from(contests);
    const now = new Date();
    const durationMs = 7200000; // 2 hours
    const lobbyDurationMs = 900000; // 15 minutes
    const startedAt = new Date(now.getTime() + lobbyDurationMs);
    const endsAt = new Date(startedAt.getTime() + durationMs);

    if (allContests.length === 0) {
      await db.insert(contests).values({
        status: 'LOBBY',
        durationMs,
        startedAt,
        endsAt,
        totalPausedMs: 0,
        lobbyStartedAt: now,
        lobbyDurationMs,
      });
    } else {
      await db.update(contests)
        .set({
          status: 'LOBBY',
          startedAt,
          endsAt,
          totalPausedMs: 0,
          lobbyStartedAt: now,
          lobbyDurationMs,
        })
        .where(eq(contests.id, allContests[0].id));
    }

    // Broadcast to all connected clients that contest lobby started
    const io = (fastify as any).io;
    if (io) {
      io.emit('contest:lobby_started', {
        startedAt: startedAt.toISOString(),
        lobbyTimeLeftMs: lobbyDurationMs,
        serverTime: now.toISOString(),
      });
    }

    return { success: true, message: 'Contest lobby started globally' };
  });

  // 1b. Pause Global Contest
  fastify.post('/admin/pause-contest', async (_request, _reply) => {
    const allContests = await db.select().from(contests);
    if (allContests.length > 0) {
      await db.update(contests)
        .set({ status: 'PAUSED', pausedAt: new Date() })
        .where(eq(contests.id, allContests[0].id));
    }
    const io = (fastify as any).io;
    if (io) {
      io.emit('contest:paused');
    }
    return { success: true, message: 'Contest paused globally' };
  });


  // 1c. End Global Contest
  fastify.post('/admin/end-contest', async (_request, _reply) => {
    const allContests = await db.select().from(contests);
    if (allContests.length > 0) {
      await db.update(contests).set({ status: 'ENDED' }).where(eq(contests.id, allContests[0].id));
    }
    const io = (fastify as any).io;
    if (io) {
      io.emit('contest:ended');
    }
    return { success: true, message: 'Contest ended globally' };
  });

  // 1d. Resume Global Contest
  fastify.post('/admin/resume-contest', async (_request, _reply) => {
    const allContests = await db.select().from(contests);
    let updatedContest = allContests[0];
    if (allContests.length > 0) {
      // Extend endsAt by the time spent paused
      const now = new Date();
      const contest = allContests[0];
      const pausedAt = contest.pausedAt ? new Date(contest.pausedAt) : now;
      const extraPausedMs = now.getTime() - pausedAt.getTime();
      const newTotalPausedMs = (contest.totalPausedMs || 0) + extraPausedMs;
      const newEndsAt = contest.endsAt
        ? new Date(new Date(contest.endsAt).getTime() + extraPausedMs)
        : null;

      const [updated] = await db.update(contests)
        .set({
          status: 'RUNNING',
          pausedAt: null,
          totalPausedMs: newTotalPausedMs,
          ...(newEndsAt ? { endsAt: newEndsAt } : {}),
        })
        .where(eq(contests.id, contest.id))
        .returning();
      updatedContest = updated;
    }
    const io = (fastify as any).io;
    if (io) {
      // Emit contest:resumed (distinct from contest:started) with updated end time
      io.emit('contest:resumed', {
        endsAt: updatedContest?.endsAt ? new Date(updatedContest.endsAt).toISOString() : null,
        serverTime: new Date().toISOString(),
      });
    }
    return { success: true, message: 'Contest resumed globally' };
  });

  // 1e. Emergency Stop Global Contest (disqualifies all teams, stops contest)
  fastify.post('/admin/emergency-stop', async (_request, _reply) => {
    const allContests = await db.select().from(contests);
    if (allContests.length > 0) {
      await db.update(contests).set({ status: 'ENDED' }).where(eq(contests.id, allContests[0].id));
    }
    
    // Disqualify and pause all teams
    await db.update(teams).set({ isPaused: true, isDisqualified: true });

    const io = (fastify as any).io;
    if (io) {
      io.emit('contest:ended');
      io.emit('team:disqualified_all');
    }
    return { success: true, message: 'Emergency stop activated. All teams disqualified.' };
  });

  // 1f. Reset Global Contest and Clear All Submissions/Scores
  fastify.post('/admin/reset-contest', async (_request, _reply) => {
    // 1. Clear submissions, team powerups, violations
    await db.delete(submissions);
    await db.delete(teamPowerups);
    await db.delete(violations);

    // 2. Reset team stats
    await db.update(teams).set({
      violationCount: 0,
      isDisqualified: false,
      isPaused: false,
      spiderSenseCharges: 1,
      hintStage: 0,
    });

    // 3. Reset contest status
    const allContests = await db.select().from(contests);
    if (allContests.length > 0) {
      await db.update(contests)
        .set({
          status: 'NOT_STARTED',
          startedAt: null,
          pausedAt: null,
          totalPausedMs: 0,
          endsAt: null,
        })
        .where(eq(contests.id, allContests[0].id));
    }

    const io = (fastify as any).io;
    if (io) {
      io.emit('contest:ended');
      await broadcastLeaderboard(io, db);
    }
    return { success: true, message: 'Contest reset. All team scores, submissions, and powerups cleared.' };
  });

  // 2. Resume a Paused Team
  fastify.post('/admin/resume-team', async (request, reply) => {
    const { teamId } = request.body as { teamId: string };
    if (!teamId) {
      return reply.code(400).send({ error: 'teamId is required' });
    }

    await db.update(teams).set({ isPaused: false, violationCount: 0 }).where(eq(teams.id, teamId));
    
    const io = (fastify as any).io;
    if (io) {
      io.emit('team:resumed', { teamId }); 
    }
    
    return { success: true, message: `Team ${teamId} resumed` };
  });

  // 3. Get all problems
  fastify.get('/api/problems', async (_request, _reply) => {
    const allProblems = await db.select({
      id: problems.id,
      title: problems.title,
      statement: problems.statement,
      order: problems.order,
      timeLimitMs: problems.timeLimitMs,
      memoryLimitMb: problems.memoryLimitMb,
      testCases: problems.testCases,
    }).from(problems).orderBy(problems.order);

    const problemsWithStarters = await Promise.all(allProblems.map(async (p) => {
      // Use PROBLEMS_DIR env var (always set in Docker to /app/problems)
      // Fall back to a path relative to the dist output for local dev.
      const problemsBase = process.env.PROBLEMS_DIR ||
        path.resolve(__dirname, '../../../problems');
      const starterDir = path.join(problemsBase, p.id, 'starter');
      const starters: Record<string, string> = {};
      try {
        starters.c = await fs.readFile(path.join(starterDir, 'c.c'), 'utf8').catch(() => '');
        starters.cpp = await fs.readFile(path.join(starterDir, 'cpp.cpp'), 'utf8').catch(() => '');
        starters.java = await fs.readFile(path.join(starterDir, 'java.java'), 'utf8').catch(() => '');
        starters.python = await fs.readFile(path.join(starterDir, 'python.py'), 'utf8').catch(() => '');
      } catch (err) {}
      return {
        ...p,
        starters,
      };
    }));

    return problemsWithStarters;
  });

  // 4. Get all teams with stats
  fastify.get('/admin/teams', async (_request, _reply) => {
    return await calculateLeaderboard(db);
  });

  // 5. Get all submissions for feed
  fastify.get('/admin/submissions', async (_request, _reply) => {
    const allSubmissions = await db.select()
      .from(submissions)
      .orderBy(desc(submissions.createdAt))
      .limit(100);
    return allSubmissions;
  });

  // ── AUTH ROUTES ─────────────────────────────────────────────────────────────

  // 6. Login — validate team credentials, return teamId
  fastify.post('/api/login', async (request, reply) => {
    const { teamName, password } = request.body as { teamName: string; password: string };
    if (!teamName || !password) {
      return reply.code(400).send({ error: 'teamName and password required' });
    }

    // Check TEST_TEAMS first (dev accounts)
    const testMatch = TEST_TEAMS.find(
      t => t.name.toLowerCase() === teamName.toLowerCase() && t.password === password
    );
    if (testMatch) {
      const token = jwt.sign({ teamId: testMatch.id, teamName: testMatch.name }, JWT_SECRET, { expiresIn: '12h' });
      return { success: true, teamId: testMatch.id, teamName: testMatch.name, token };
    }

    // Fall back to DB lookup (for real contest teams)
    const dbTeams = await db.select().from(teams)
      .where(eq(teams.name, teamName));
    if (dbTeams.length === 0) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Team not found.' });
    }
    const team = dbTeams[0];
    // Plain-text password comparison (matches how seedTestTeams stores it)
    if (team.passwordHash !== password) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Incorrect password.' });
    }
    const token = jwt.sign({ teamId: team.id, teamName: team.name }, JWT_SECRET, { expiresIn: '12h' });
    return { success: true, teamId: team.id, teamName: team.name, token };
  });

  // 7. Test teams listing (dev only — used to show quick-login buttons in the electron client)
  fastify.get('/api/test-teams', async (_request, _reply) => {
    return TEST_TEAMS.map(t => ({ id: t.id, name: t.name, password: t.password }));
  });

  // 8. Get team state by teamId (used for reconnect sync)
  fastify.get('/api/teams/me/:teamId', async (request, reply) => {
    const { teamId } = request.params as { teamId: string };
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) return reply.code(404).send({ error: 'Team not found' });

    const acSubs = await db.select({ problemId: submissions.problemId })
      .from(submissions)
      .where(and(eq(submissions.teamId, teamId), eq(submissions.verdict, 'AC')));
    const solvedCount = new Set(acSubs.map(s => s.problemId)).size;

    return {
      teamId: team.id,
      teamName: team.name,
      hintStage: team.hintStage,
      solvedCount,
      violationCount: team.violationCount,
      isPaused: team.isPaused,
      isDisqualified: team.isDisqualified,
    };
  });

  // 9. Analytics endpoint
  fastify.get('/admin/analytics', async (_request, _reply) => {
    const allSubs = await db.select().from(submissions);
    const allPowerups = await db.select().from(teamPowerups);
    const allViolations = await db.select().from(violations);
    const allTeams = await db.select().from(teams);

    const problemStats = new Map<string, { attempts: number, solved: number, bypassed: number, failed: number }>();
    
    for (const sub of allSubs) {
      if (!problemStats.has(sub.problemId)) {
        problemStats.set(sub.problemId, { attempts: 0, solved: 0, bypassed: 0, failed: 0 });
      }
      const stat = problemStats.get(sub.problemId)!;
      stat.attempts++;
      if (sub.verdict === 'AC') stat.solved++;
      else if (sub.verdict === 'BYPASSED') stat.bypassed++;
      else stat.failed++;
    }

    let mostSolvedId = 'None';
    let maxSolved = -1;
    let mostFailedId = 'None';
    let maxFailed = -1;
    let mostBypassedId = 'None';
    let maxBypassed = -1;

    for (const [pId, stat] of problemStats.entries()) {
      if (stat.solved > maxSolved) { maxSolved = stat.solved; mostSolvedId = pId; }
      if (stat.failed > maxFailed) { maxFailed = stat.failed; mostFailedId = pId; }
      if (stat.bypassed > maxBypassed) { maxBypassed = stat.bypassed; mostBypassedId = pId; }
    }

    let totalRuntime = 0;
    let totalMemory = 0;
    let validCount = 0;
    
    for (const sub of allSubs) {
      if (sub.verdict === 'AC') {
        if (sub.runtimeMs && sub.runtimeMs >= 0) {
          totalRuntime += sub.runtimeMs;
          totalMemory += sub.memoryKb || 0;
          validCount++;
        }
      }
    }

    const avgRuntime = validCount ? Math.round(totalRuntime / validCount) : 0;
    const avgMemory = validCount ? Math.round(totalMemory / validCount) : 0;
    const avgAttempts = allTeams.length ? +(allSubs.length / allTeams.length).toFixed(1) : 0;
    
    const spiderSenseUsage = allPowerups.filter(p => p.type === 'SPIDER_SENSE').length;
    const totalPowerupUsage = allPowerups.length;
    const violationCount = allViolations.length;

    // Fastest Solve
    let fastestSolve = -1;
    for (const sub of allSubs) {
      if (sub.verdict === 'AC' && sub.runtimeMs !== null && sub.runtimeMs >= 0) {
        if (fastestSolve === -1 || sub.runtimeMs < fastestSolve) {
          fastestSolve = sub.runtimeMs;
        }
      }
    }

    return {
      mostSolvedQuestion: mostSolvedId,
      mostFailedQuestion: mostFailedId,
      mostBypassedQuestion: mostBypassedId,
      averageAttempts: avgAttempts,
      averageRuntime: avgRuntime,
      averageMemory: avgMemory,
      spiderSenseUsage,
      totalPowerupUsage,
      violationCount,
      fastestSolve: fastestSolve === -1 ? 0 : fastestSolve
    };
  });
}
