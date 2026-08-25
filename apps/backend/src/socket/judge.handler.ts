import { db } from '../db';
import { problems, submissions, teams, contests } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { SupportedLanguage } from '../judge/languages';
import { judgeQueue, judgeQueueEvents, DEFAULT_JOB_OPTIONS } from '../judge/queue';
import { broadcastLeaderboard } from '../utils/leaderboard';

// H1: Per-team submission cooldown (5 seconds) to prevent spam
const lastSubmitTime = new Map<string, number>();
const SUBMIT_COOLDOWN_MS = 5000;

export function registerJudgeHandlers(socket: any) {
  socket.on('run:code', async ({ problemId, code, language, stdin }: { problemId?: string; code: string; language: SupportedLanguage; stdin: string }) => {
    const handlerStart = Date.now();
    try {
      console.log(`[Judge] Enqueuing code run for problem: ${problemId}, language: ${language}`);
      
      const dbStart = Date.now();
      let expectedOutput: string | undefined = undefined;
      if (problemId) {
        const [problem] = await db.select().from(problems).where(eq(problems.id, problemId));
        if (problem) {
          const testCases = (problem.testCases as any[]) || [];
          const matchedTc = testCases.find(tc => tc.input.trim() === stdin.trim());
          if (matchedTc) {
            expectedOutput = matchedTc.output;
          }
        }
      }
      const databaseTime = Date.now() - dbStart;

      const queueStart = Date.now();
      const job = await judgeQueue.add('run-job', {
        type: 'run',
        language,
        code,
        stdin,
        expectedOutput
      }, DEFAULT_JOB_OPTIONS);
      const result = await job.waitUntilFinished(judgeQueueEvents);
      const executionTime = Date.now() - queueStart;

      const socketStart = Date.now();
      socket.emit('run:result', result);
      const socketTime = Date.now() - socketStart;

      const totalTime = Date.now() - handlerStart;
      console.log(`[Run Timing Audit] Problem: ${problemId || 'N/A'}, Language: ${language}, databaseTime: ${databaseTime}ms, queueWaitAndExecutionTime: ${executionTime}ms, socketTime: ${socketTime}ms, totalTime: ${totalTime}ms`);
    } catch (err) {
      console.error('[Judge Error]:', err);
      socket.emit('run:result', { verdict: 'CE', stdout: '', stderr: 'Internal Server Error during execution', runtimeMs: 0 });
    }
  });

  socket.on('submit:code', async ({ problemId, code, language }: { problemId: string; code: string; language: SupportedLanguage }) => {
    const handlerStart = Date.now();
    let databaseTime = 0;
    let executionTime = 0;
    let socketTime = 0;

    try {
      const dbStart = Date.now();
      // HIGH-4: Validate contest is RUNNING before accepting any submission
      const [globalContest] = await db.select().from(contests);
      if (!globalContest || globalContest.status !== 'RUNNING') {
        socket.emit('submit:result', { status: 'REJECTED', message: 'Contest is not currently running.' });
        return;
      }

      // HIGH-4: Validate the team exists and is not paused
      const teamId = socket.data?.teamId;
      if (!teamId) {
        socket.emit('submit:result', { status: 'REJECTED', message: 'Not authenticated. Please reconnect.' });
        return;
      }

      // H1: Rate-limit check
      const now = Date.now();
      const lastSubmit = lastSubmitTime.get(teamId) || 0;
      if (now - lastSubmit < SUBMIT_COOLDOWN_MS) {
        const remaining = Math.ceil((SUBMIT_COOLDOWN_MS - (now - lastSubmit)) / 1000);
        socket.emit('submit:result', { status: 'REJECTED', message: `Please wait ${remaining}s before submitting again.` });
        return;
      }
      lastSubmitTime.set(teamId, now);

      const [existingTeam] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!existingTeam) {
        socket.emit('submit:result', { status: 'REJECTED', message: 'Team not found.' });
        return;
      }

      console.log(`[Judge] Enqueuing submission for problem: ${problemId}, language: ${language}`);
      const [problem] = await db.select().from(problems).where(eq(problems.id, problemId));
      if (!problem) {
        throw new Error('Problem not found');
      }

      const testCases: any[] = (problem.testCases as any[]) || [];
      databaseTime += Date.now() - dbStart;

      socket.emit('submit:progress', { stage: 'COMPILING', currentTest: 0, totalTests: testCases.length });

      // Dispatch to BullMQ
      const queueStart = Date.now();
      const job = await judgeQueue.add('submit-job', {
        type: 'submit',
        language,
        code,
        testCases: testCases.map(tc => ({ input: tc.input, output: tc.output }))
      }, DEFAULT_JOB_OPTIONS);

      const progressListener = (args: { jobId: string; data: any }) => {
        if (args.jobId === job.id) {
          const socketEmitStart = Date.now();
          socket.emit('submit:progress', args.data);
          socketTime += Date.now() - socketEmitStart;
        }
      };

      judgeQueueEvents.on('progress', progressListener);

      let jobResult;
      try {
        jobResult = await job.waitUntilFinished(judgeQueueEvents);
      } finally {
        judgeQueueEvents.off('progress', progressListener);
      }
      executionTime = Date.now() - queueStart;

      const dbTxStart = Date.now();
      const results = jobResult.results;
      const overallVerdict = jobResult.overallVerdict;
      const maxRuntime = jobResult.maxRuntime;

      const [submission] = await db.transaction(async (tx) => {
        const [sub] = await tx.insert(submissions).values({
          teamId,
          problemId, 
          language: language.toUpperCase() as any,
          sourceCode: code,
          status: 'DONE', 
          verdict: overallVerdict,
          runtimeMs: maxRuntime, 
          testCaseResults: results,
        }).returning();

        // Recalculate progress for this team
        if (overallVerdict === 'AC') {
          const teamSubmissions = await tx.select({
            problemId: submissions.problemId,
            verdict: submissions.verdict,
          })
          .from(submissions)
          .where(and(
            eq(submissions.teamId, teamId),
            inArray(submissions.verdict, ['AC', 'BYPASSED'])
          ));

          const solvedIds = Array.from(new Set(teamSubmissions.filter(s => s.verdict === 'AC').map(s => s.problemId)));
          const bypassedIds = Array.from(new Set(teamSubmissions.filter(s => s.verdict === 'BYPASSED').map(s => s.problemId)));
          const distinctTotal = new Set([...solvedIds, ...bypassedIds]).size;
          
          let newHintStage = 0;
          if (distinctTotal >= 10) newHintStage = 3;
          else if (distinctTotal >= 6) newHintStage = 2;
          else if (distinctTotal >= 3) newHintStage = 1;

          const currentStage = existingTeam?.hintStage ?? 0;
          const finalHintStage = Math.max(currentStage, newHintStage);
          if (finalHintStage > currentStage) {
            await tx.update(teams).set({ hintStage: finalHintStage }).where(eq(teams.id, teamId));
          }
          
          socket.to(`team:${teamId}`).emit('team:progress_updated', {
            hintStage: finalHintStage,
            solvedCount: distinctTotal,
            solvedProblemIds: solvedIds,
            bypassedProblemIds: bypassedIds,
          });
          socket.emit('team:progress_updated', {
            hintStage: finalHintStage,
            solvedCount: distinctTotal,
            solvedProblemIds: solvedIds,
            bypassedProblemIds: bypassedIds,
          });
        }
        
        return [sub];
      });
      databaseTime += Date.now() - dbTxStart;

      const finalSocketStart = Date.now();
      socket.emit('submit:result', { 
        status: 'DONE', 
        verdict: submission.verdict,
        testCases: results,
        testCaseResults: results, // alias — frontend reads this field
        problemId
      });

      // Broadcast global leaderboard if the state changed
      if (overallVerdict === 'AC') {
        const io = (socket as any).server || socket.conn?.server;
        await broadcastLeaderboard(io, db);
      }
      socketTime += Date.now() - finalSocketStart;

      const totalTime = Date.now() - handlerStart;
      console.log(`[Submission Timing Audit] Team: ${teamId}, Problem: ${problemId}, Language: ${language}, databaseTime: ${databaseTime}ms, queueWaitAndExecutionTime: ${executionTime}ms, socketTime: ${socketTime}ms, totalTime: ${totalTime}ms`);
    } catch (err) {
      console.error('[Judge Error]:', err);
      socket.emit('submit:result', { status: 'FAILED', message: 'Internal Server Error during execution' });
    }
  });

}
