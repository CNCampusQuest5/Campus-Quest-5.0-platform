import { db } from '../db';
import { teamPowerups, teams, contests, submissions, spiderSenseChallenges } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { broadcastLeaderboard } from '../utils/leaderboard';
import { QUESTION_POOL } from '../config/mcqPool';

const POWERUP_LIMITS = {
  SPIDER_SENSE: 3,
  WEB_FLUID: 2,
  SUIT_TECH: 2
};

// Helper: Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function registerPowerupHandlers(socket: any, io: any) {
  
  // ── 1. Create a secure Spider-Sense MCQ Challenge ───────────────────────────
  socket.on('powerup:spider_sense_init', async ({ problemId }: { problemId: string }) => {
    const teamId = socket.data?.teamId;
    if (!teamId) return;

    try {
      // Validate team and contest state
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!team) {
        return socket.emit('powerup:error', { message: 'Team not found' });
      }

      if (team.isPaused || team.isDisqualified) {
        return socket.emit('powerup:error', { message: 'Action disabled: Team is paused or disqualified.' });
      }

      const [contest] = await db.select().from(contests);
      if (!contest || contest.status !== 'RUNNING') {
        return socket.emit('powerup:error', { message: 'Contest is not running.' });
      }

      // Check Spider-Sense availability limits
      const usages = await db.select()
        .from(teamPowerups)
        .where(and(eq(teamPowerups.teamId, teamId), eq(teamPowerups.type, 'SPIDER_SENSE')));
      if (usages.length >= POWERUP_LIMITS.SPIDER_SENSE || team.spiderSenseCharges <= 0) {
        return socket.emit('powerup:error', { message: 'No Spider-Sense charges remaining in inventory.' });
      }

      if (!problemId) {
        return socket.emit('powerup:error', { message: 'Mission ID required to activate Spider-Sense.' });
      }

      if (problemId === '10-final-mission') {
        return socket.emit('powerup:error', { message: 'Spider-Sense cannot be used on the Final Mission.' });
      }

      // Select 3 random unique questions from the 36-question pool
      const selectedQuestions = shuffleArray(QUESTION_POOL).slice(0, 3);
      const questionIds = selectedQuestions.map(q => q.id);

      const optionsList: string[][] = [];
      const correctIndices: number[] = [];

      for (const q of selectedQuestions) {
        // Shuffle option order
        const shuffledOpts = shuffleArray(q.options);
        optionsList.push(shuffledOpts);
        correctIndices.push(shuffledOpts.indexOf(q.correctAnswer));
      }

      // Insert secure challenge session into DB
      const [challenge] = await db.insert(spiderSenseChallenges).values({
        teamId,
        problemId,
        questionIds,
        correctIndices,
        optionsList,
        attemptCount: 0,
        completedQuestions: 0,
        isCompleted: false,
        isConsumed: false
      }).returning();

      // Return sanitized challenge info to client (strip correct answer indices!)
      socket.emit('powerup:spider_sense_challenge', {
        challengeId: challenge.id,
        problemId,
        questions: selectedQuestions.map((q, idx) => ({
          id: q.id,
          question: q.question,
          options: optionsList[idx]
        }))
      });

    } catch (err: any) {
      console.error('[Spider-Sense Init Error]:', err.message);
      socket.emit('powerup:error', { message: 'Failed to initialize Spider-Sense challenge.' });
    }
  });

  // ── 2. Validate Spider-Sense Challenge Question Answer ─────────────────────
  socket.on('powerup:spider_sense_submit', async ({
    challengeId,
    questionId,
    selectedAnswer
  }: {
    challengeId: string;
    questionId: number;
    selectedAnswer: string;
  }) => {
    const teamId = socket.data?.teamId;
    if (!teamId) return;

    try {
      const [challenge] = await db.select().from(spiderSenseChallenges).where(eq(spiderSenseChallenges.id, challengeId));
      if (!challenge || challenge.teamId !== teamId) {
        return socket.emit('powerup:error', { message: 'Invalid challenge session.' });
      }

      if (challenge.isCompleted) {
        return socket.emit('powerup:error', { message: 'Challenge is already completed.' });
      }

      // Check current progress
      const qIndex = challenge.completedQuestions; // 0, 1, or 2
      if (challenge.questionIds[qIndex] !== questionId) {
        return socket.emit('powerup:error', { message: 'Incorrect question sequence.' });
      }

      const correctOptionText = challenge.optionsList[qIndex][challenge.correctIndices[qIndex]];
      const isAnswerCorrect = selectedAnswer === correctOptionText;

      if (isAnswerCorrect) {
        const nextCompleted = qIndex + 1;
        const finished = nextCompleted === 3;

        await db.update(spiderSenseChallenges)
          .set({
            completedQuestions: nextCompleted,
            isCompleted: finished,
            completedAt: finished ? new Date() : null
          })
          .where(eq(spiderSenseChallenges.id, challengeId));

        socket.emit('powerup:spider_sense_result', {
          questionId,
          success: true,
          nextIndex: nextCompleted,
          isCompleted: finished
        });

      } else {
        // Failed attempt: increment count and reset progress to 0 (must restart)
        await db.update(spiderSenseChallenges)
          .set({
            completedQuestions: 0,
            attemptCount: challenge.attemptCount + 1
          })
          .where(eq(spiderSenseChallenges.id, challengeId));

        socket.emit('powerup:spider_sense_result', {
          questionId,
          success: false,
          nextIndex: 0,
          isCompleted: false
        });
      }

    } catch (err: any) {
      console.error('[Spider-Sense Submit Error]:', err.message);
      socket.emit('powerup:error', { message: 'Failed to process answer submission.' });
    }
  });

  // ── 3. Consume Spider-Sense and Apply Bypass ────────────────────────────────
  socket.on('powerup:spider_sense_confirm', async ({ challengeId }: { challengeId: string }) => {
    const teamId = socket.data?.teamId;
    if (!teamId) return;

    try {
      const [challenge] = await db.select().from(spiderSenseChallenges).where(eq(spiderSenseChallenges.id, challengeId));
      if (!challenge || challenge.teamId !== teamId || !challenge.isCompleted) {
        return socket.emit('powerup:error', { message: 'Challenge has not been successfully completed.' });
      }

      if (challenge.isConsumed) {
        return socket.emit('powerup:error', { message: 'This bypass authorization has already been used.' });
      }

      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!team || team.spiderSenseCharges <= 0) {
        return socket.emit('powerup:error', { message: 'Insufficient Spider-Sense charges.' });
      }

      const problemId = challenge.problemId;

      await db.transaction(async (tx) => {
        // 1. Mark challenge as consumed
        await tx.update(spiderSenseChallenges)
          .set({ isConsumed: true })
          .where(eq(spiderSenseChallenges.id, challengeId));

        // 2. Consume Spider-Sense charge
        await tx.update(teams)
          .set({ spiderSenseCharges: team.spiderSenseCharges - 1 })
          .where(eq(teams.id, teamId));

        // 3. Create BYPASSED submission
        await tx.insert(submissions).values({
          teamId,
          problemId,
          language: 'PYTHON',
          sourceCode: 'SPIDER_SENSE_SECURE_BYPASS',
          verdict: 'BYPASSED',
          runtimeMs: -1,
          memoryKb: -1,
          createdAt: new Date(),
          testCaseResults: [{ index: 0, verdict: 'BYPASSED', runtimeMs: 0, memoryKb: 0 }]
        });

        // 4. Add powerup usage record
        await tx.insert(teamPowerups).values({
          teamId,
          type: 'SPIDER_SENSE',
          usedAt: new Date(),
        });
      });

      // Emit results and updates
      socket.emit('submit:result', { 
        status: 'DONE', 
        verdict: 'BYPASSED',
        problemId 
      });

      const allTeamSubs = await db.select({ problemId: submissions.problemId, verdict: submissions.verdict })
        .from(submissions)
        .where(and(
          eq(submissions.teamId, teamId),
          inArray(submissions.verdict, ['AC', 'BYPASSED'])
        ));
      const solvedIds = Array.from(new Set(allTeamSubs.filter(s => s.verdict === 'AC').map(s => s.problemId)));
      const bypassedIds = Array.from(new Set(allTeamSubs.filter(s => s.verdict === 'BYPASSED').map(s => s.problemId)));
      const totalSolvedOrBypassed = new Set([...solvedIds, ...bypassedIds]).size;
      
      let newHintStage = 0;
      if (totalSolvedOrBypassed >= 10) newHintStage = 3;
      else if (totalSolvedOrBypassed >= 6) newHintStage = 2;
      else if (totalSolvedOrBypassed >= 3) newHintStage = 1;

      if (newHintStage > team.hintStage) {
        await db.update(teams).set({ hintStage: newHintStage }).where(eq(teams.id, teamId));
      }
      const finalHintStage = Math.max(team.hintStage, newHintStage);

      const progressPayload = {
        hintStage: finalHintStage,
        solvedCount: totalSolvedOrBypassed,
        solvedProblemIds: solvedIds,
        bypassedProblemIds: bypassedIds,
      };

      socket.emit('team:progress_updated', progressPayload);
      socket.to(`team:${teamId}`).emit('team:progress_updated', progressPayload);

      // Re-fetch inventories and notify clients
      const allUsages = await db.select()
        .from(teamPowerups)
        .where(eq(teamPowerups.teamId, teamId));
        
      const counts = {
        SPIDER_SENSE: allUsages.filter(p => p.type === 'SPIDER_SENSE').length,
        WEB_FLUID: allUsages.filter(p => p.type === 'WEB_FLUID').length,
        SUIT_TECH: allUsages.filter(p => p.type === 'SUIT_TECH').length
      };

      socket.emit('powerup:updated', counts);
      io.to('admin-room').emit('admin:powerup_used', { teamId, type: 'SPIDER_SENSE', counts });

      const ioServer = (socket as any).server || socket.conn?.server;
      await broadcastLeaderboard(ioServer, db);

    } catch (err: any) {
      console.error('[Spider-Sense Confirm Error]:', err.message);
      socket.emit('powerup:error', { message: 'Failed to finalize Spider-Sense bypass.' });
    }
  });

  // ── 4. Use other powerups (WEB_FLUID, SUIT_TECH) ───────────────────────────
  socket.on('powerup:use', async ({ type }: { type: 'WEB_FLUID' | 'SUIT_TECH' }) => {
    const teamId = socket.data?.teamId;
    if (!teamId) return;

    try {
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!team || team.isPaused || team.isDisqualified) return;

      const [contest] = await db.select().from(contests);
      if (!contest || contest.status !== 'RUNNING') return;

      const usages = await db.select()
        .from(teamPowerups)
        .where(and(eq(teamPowerups.teamId, teamId), eq(teamPowerups.type, type)));
      if (usages.length >= POWERUP_LIMITS[type]) return;

      await db.insert(teamPowerups).values({
        teamId,
        type,
        usedAt: new Date()
      });

      if (type === 'WEB_FLUID') {
        // Freeze ONLY this team's timer by setting/extending freezeEndsAt in DB
        const now = Date.now();
        const baseTime = team.freezeEndsAt && new Date(team.freezeEndsAt).getTime() > now
          ? new Date(team.freezeEndsAt).getTime()
          : now;
        const newFreezeEndsAt = new Date(baseTime + 120000);

        await db.update(teams)
          .set({ freezeEndsAt: newFreezeEndsAt })
          .where(eq(teams.id, teamId));

        const ioServer = (socket as any).server || socket.conn?.server;
        if (ioServer) {
          ioServer.to(`team:${teamId}`).emit('team:timer_frozen', {
            freezeEndsAt: newFreezeEndsAt.toISOString(),
            serverTime: new Date().toISOString()
          });
        }
      }

      const allUsages = await db.select()
        .from(teamPowerups)
        .where(eq(teamPowerups.teamId, teamId));
        
      const counts = {
        SPIDER_SENSE: allUsages.filter(p => p.type === 'SPIDER_SENSE').length,
        WEB_FLUID: allUsages.filter(p => p.type === 'WEB_FLUID').length,
        SUIT_TECH: allUsages.filter(p => p.type === 'SUIT_TECH').length
      };

      socket.emit('powerup:updated', counts);
      io.to('admin-room').emit('admin:powerup_used', { teamId, type, counts });

    } catch (err: any) {
      console.error('[Powerup Use Error]:', err.message);
    }
  });
}
