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
import { runMigrations, verifySchema } from './db/migrate';
import { db, client as pgClient } from './db';
import { connection as redisConnection } from './config/redis';
import { contests } from './db/schema';
import { eq, sql } from 'drizzle-orm';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

let isDbReady = false;

async function bootstrap() {
  console.log('[Startup] NODE_ENV=production');
  console.log(`[Startup] PORT=${PORT}`);
  console.log(`[Startup] Host=${HOST}`);
  console.log('[Startup] Health endpoint=/health');
  console.log('[Startup] Readiness endpoint=/ready');

  // Validate required environment variables (Do NOT print values to log!)
  const REQUIRED_ENV = ['DATABASE_URL'];
  const missing = REQUIRED_ENV.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Startup] ❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('[Startup] Please check your environment configuration and restart.');
    process.exit(1);
  }

  // Create lightweight Fastify instance
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(helmet, { contentSecurityPolicy: false });

  await fastify.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // 1. Lightweight Liveness Check: /health (HTTP 200 OK)
  fastify.get('/health', async () => ({ status: 'ok' }));

  // 2. Comprehensive Readiness Check: /ready (HTTP 200 if ready, HTTP 503 if not ready)
  fastify.get('/ready', async (_req, reply) => {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
      ]);
    };

    try {
      await withTimeout(db.execute(sql`SELECT 1`), 2000);
      const schemaCheck = await withTimeout(verifySchema(), 2000);
      if (schemaCheck.ok) {
        dbStatus = 'connected';
      } else {
        dbStatus = 'migration_failed';
      }
    } catch (err: any) {
      dbStatus = err?.message === 'Timeout' ? 'timeout' : 'error';
    }

    try {
      await withTimeout(redisConnection.ping(), 2000);
      redisStatus = 'connected';
    } catch (err: any) {
      redisStatus = err?.message === 'Timeout' ? 'timeout' : 'error';
    }

    const ready = dbStatus === 'connected' && redisStatus === 'connected';

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  });

  // Register admin & workspace API routes
  await fastify.register(adminRoutes);
  await fastify.register(workspaceRoutes);
  await fastify.register(demoRoutes);

  // Socket.IO Setup — allow all origins so Electron desktop binary file:// protocol works cleanly
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
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

  // Bind Fastify Server to port first
  await fastify.listen({ port: PORT, host: HOST });
  console.log('[Startup] Server listening');
  console.log('[Startup] Socket.IO=ready');

  // ── Sequential initialization operations after binding ──
  
  // 1. Redis Connection
  try {
    await redisConnection.ping();
    console.log('[Startup] Redis=connected');
  } catch (err: any) {
    console.warn('[Startup] ⚠️ Redis connection failed:', err.message);
  }

  // 2. PostgreSQL Connection & Migration Execution
  const migrationOk = await runMigrations();
  if (migrationOk) {
    isDbReady = true;
    console.log('[Startup] Database=connected');
    console.log('[Startup] Database migration & schema verification passed');

    // 3. Problem Synchronization
    try {
      const syncResult = await syncProblemsToDatabase();
      console.log(`[Startup] Problems loaded: ${syncResult.totalProblems} problems, ${syncResult.totalTestcases} testcases`);
    } catch (err: any) {
      console.error('[Startup] ❌ Problems synchronization failed:', err.message);
    }

    // 4. Test Team Seeding
    try {
      await seedTestTeams();
      console.log('[Startup] Seed verification passed');
    } catch (err: any) {
      console.error('[Startup] ❌ Test team seeding failed:', err.message);
    }
  } else {
    console.error('[Startup] ❌ Database migrations or schema verification failed.');
  }

  // 5. Judge Worker Queue
  let worker: any = null;
  if (process.env.DISABLE_JUDGE_WORKER !== 'true') {
    try {
      worker = startJudgeWorker();
      console.log('[Startup] Judge worker=ready');
    } catch (err: any) {
      console.error('[Startup] ❌ Judge worker initialization failed:', err.message);
    }
  }

  // 6. Server-authoritative lobby timer check interval (Throttles error logs if DB is uninitialized)
  let lastLobbyErrorTime = 0;
  setInterval(async () => {
    if (!isDbReady) return; // Don't run interval queries until database schema is verified
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
      const now = Date.now();
      if (now - lastLobbyErrorTime > 30000) { // Throttle log to once every 30 seconds
        console.error('[Contest Engine] Error in lobby check interval:', err.message);
        lastLobbyErrorTime = now;
      }
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
      await redisConnection.quit().catch(() => {});
      await pgClient.end().catch(() => {});
      console.log('[Shutdown] All connections closed. Goodbye.');
      process.exit(0);
    });
  }
}

bootstrap().catch(err => {
  console.error('[Fatal] Failed to start server:', err);
  process.exit(1);
});
