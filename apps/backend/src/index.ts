import './config/env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Server as SocketIOServer } from 'socket.io';

import adminRoutes from './routes/admin';
import { seedTestTeams } from './routes/admin';
import workspaceRoutes from './routes/workspace';
import demoRoutes from './routes/demo';
import { registerJudgeHandlers } from './socket/judge.handler';
import { registerContestHandlers } from './socket/contest.handler';
import { registerPowerupHandlers } from './socket/powerup.handler';
import { syncProblemsToDatabase } from './services/problems';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, ADMIN_SECRET } from './routes/admin';
import { startJudgeWorker } from './workers/judge.worker';
import { runMigrations } from './db/migrate';
import { db } from './db';
import { connection as redisConnection } from './config/redis';
import { contests } from './db/schema';
import { eq, sql } from 'drizzle-orm';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:3000').split(',');

async function bootstrap() {
  console.log('[Startup] NODE_ENV=production');
  console.log(`[Startup] PORT=${PORT}`);
  console.log(`[Startup] Host=${HOST}`);
  console.log('[Startup] Health endpoint=/health');

  // Validate required environment variables (Do NOT print values to log!)
  const REQUIRED_ENV = ['DATABASE_URL'];
  const missing = REQUIRED_ENV.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Startup] ❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('[Startup] Please check your environment configuration and restart.');
    process.exit(1);
  }

  // Create lightweight Fastify instance first so we can bind the health port immediately
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin.endsWith('.vercel.app')) return cb(null, true);
      if (origin.startsWith('http://localhost')) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  await fastify.register(helmet, { contentSecurityPolicy: false });

  await fastify.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // 1. Lightweight health check - binds immediately, does NOT fail if database/redis is starting
  fastify.get('/health', async () => ({ status: 'ok' }));

  // 2. Detailed health check
  fastify.get('/health/detailed', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }
    try {
      await redisConnection.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }
    checks.judgeWorker = process.env.DISABLE_JUDGE_WORKER !== 'true' ? 'ok' : 'disabled';
    const allOk = Object.values(checks).every(v => v === 'ok' || v === 'disabled');
    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // Register admin API routes
  await fastify.register(adminRoutes);
  await fastify.register(workspaceRoutes);
  await fastify.register(demoRoutes);

  // Socket.IO Setup
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (origin.endsWith('.vercel.app')) return cb(null, true);
        if (origin.startsWith('http://localhost')) return cb(null, true);
        if (CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  (fastify as any).io = io;

  // Socket.IO Auth Middleware
  io.use((socket, next) => {
    const incomingSecret = socket.handshake.auth?.adminSecret;
    if (incomingSecret) {
      if (incomingSecret !== ADMIN_SECRET) {
        return next(new Error('Invalid admin secret'));
      }
      socket.data = { isAdmin: true };
      return next();
    }

    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication token missing'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { teamId: string; teamName: string };
      socket.data = { teamId: decoded.teamId, teamName: decoded.teamName };
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const teamId = socket.data?.teamId;
    if (teamId) {
      socket.join(teamId);
      socket.join(`team:${teamId}`);
    }

    registerJudgeHandlers(socket);
    registerContestHandlers(socket, io);
    registerPowerupHandlers(socket, io);

    socket.on('join:admin', () => {
      if (socket.data?.isAdmin) {
        socket.join('admin-room');
      }
    });
  });

  // Bind Fastify Server to port so healthchecks immediately resolve 200 OK
  await fastify.listen({ port: PORT, host: HOST });
  console.log('[Startup] Server listening');
  console.log('[Startup] Socket.IO=ready');

  // ── Non-critical initialization operations executed asynchronously after binding ──
  
  // 1. Run migrations safely
  runMigrations().then(() => {
    console.log('[Startup] Database=connected');
  }).catch(err => {
    console.error('[Startup] ❌ Database connection/migration error:', err.message);
  });

  // 2. Redis connection test
  redisConnection.ping().then(() => {
    console.log('[Startup] Redis=connected');
  }).catch(err => {
    console.warn('[Startup] ⚠️ Redis connection failed:', err.message);
  });

  // 3. Problem syncing
  syncProblemsToDatabase().then((syncResult) => {
    console.log(`[Startup] Problems loaded: ${syncResult.totalProblems} problems, ${syncResult.totalTestcases} testcases`);
  }).catch(err => {
    console.error('[Startup] ❌ Problem sync failed:', err.message);
  });

  // 4. Seed test teams
  seedTestTeams().catch(err => {
    console.error('[Startup] ❌ Test team seeding failed:', err.message);
  });

  // 5. Start background worker queue
  let worker: any = null;
  if (process.env.DISABLE_JUDGE_WORKER !== 'true') {
    try {
      worker = startJudgeWorker();
      console.log('[Startup] Judge worker=ready');
    } catch (err: any) {
      console.error('[Startup] ❌ Judge worker initialization failed:', err.message);
    }
  }

  // Server-authoritative lobby timer check tick
  setInterval(async () => {
    try {
      const allContests = await db.select().from(contests);
      if (allContests.length > 0) {
        const contest = allContests[0];
        if (contest.status === 'LOBBY' && contest.startedAt) {
          const now = new Date();
          if (now.getTime() >= new Date(contest.startedAt).getTime()) {
            await db.update(contests)
              .set({ status: 'RUNNING' })
              .where(eq(contests.id, contest.id));

            if (io) {
              io.emit('contest:started', {
                endsAt: contest.endsAt ? new Date(contest.endsAt).toISOString() : null,
                serverTime: now.toISOString()
              });
            }
            console.log('[Contest Engine] Lobby expired. Contest is now RUNNING.');
          }
        }
      }
    } catch (err: any) {
      console.error('[Contest Engine] Error in lobby check interval:', err.message);
    }
  }, 1000);

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\n[Shutdown] ${signal} received, shutting down gracefully…`);
      if (worker) {
        await worker.close();
      }
      io.close();
      await fastify.close();
      console.log('[Shutdown] Server closed. Goodbye.');
      process.exit(0);
    });
  }
}

bootstrap().catch(err => {
  console.error('[Fatal] Failed to start server:', err);
  process.exit(1);
});
