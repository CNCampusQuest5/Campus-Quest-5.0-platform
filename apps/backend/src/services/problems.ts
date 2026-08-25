import { db } from '../db';
import { problems } from '../db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

export async function syncProblemsToDatabase(): Promise<{ totalProblems: number; totalTestcases: number }> {
  const problemsDir = process.env.PROBLEMS_DIR || path.resolve(process.cwd(), '../../problems');
  console.log(`[Sync Problems] Scanning problems directory: ${problemsDir}`);
  let totalProblems = 0;
  let totalTestcases = 0;

  try {
    const items = await fs.readdir(problemsDir);
    for (const item of items) {
      const itemPath = path.join(problemsDir, item);
      const stat = await fs.stat(itemPath);
      if (!stat.isDirectory()) continue;

      const configPath = path.join(itemPath, 'problem.json');
      const statementPath = path.join(itemPath, 'statement.md');
      
      try {
        const configRaw = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configRaw);

        const statement = await fs.readFile(statementPath, 'utf8').catch(() => 'No statement provided.');

        // Read sample testcases
        const testCases: any[] = [];
        const samplesDir = path.join(itemPath, 'samples');
        try {
          const sampleFiles = await fs.readdir(samplesDir);
          const inFiles = sampleFiles.filter(f => f.endsWith('.in'));
          for (const inFile of inFiles) {
            const num = inFile.replace('.in', '');
            const input = await fs.readFile(path.join(samplesDir, inFile), 'utf8');
            const output = await fs.readFile(path.join(samplesDir, `${num}.out`), 'utf8').catch(() => '');
            testCases.push({ input, output, hidden: false });
          }
        } catch (e: any) {
          console.warn(`[Sync Problems] Could not read samples for ${item}:`, e.message);
        }

        // Read hidden testcases
        const hiddenDir = path.join(itemPath, 'hidden');
        try {
          const hiddenFiles = await fs.readdir(hiddenDir);
          const inFiles = hiddenFiles.filter(f => f.endsWith('.in'));
          for (const inFile of inFiles) {
            const num = inFile.replace('.in', '');
            const input = await fs.readFile(path.join(hiddenDir, inFile), 'utf8');
            const output = await fs.readFile(path.join(hiddenDir, `${num}.out`), 'utf8').catch(() => '');
            testCases.push({ input, output, hidden: true });
          }
        } catch (e: any) {
          console.warn(`[Sync Problems] Could not read hidden tests for ${item}:`, e.message);
        }

        // Upsert into DB
        const existing = await db.select().from(problems).where(eq(problems.id, config.id));
        if (existing.length > 0) {
          await db.update(problems).set({
            title: config.title,
            statement: statement,
            order: config.order || 1,
            timeLimitMs: config.timeLimit || 2000,
            memoryLimitMb: config.memoryLimit || 256,
            testCases,
          }).where(eq(problems.id, config.id));
        } else {
          await db.insert(problems).values({
            id: config.id,
            title: config.title,
            statement: statement,
            order: config.order || 1,
            timeLimitMs: config.timeLimit || 2000,
            memoryLimitMb: config.memoryLimit || 256,
            testCases,
          });
        }
        console.log(`[Sync Problems] Successfully synced: ${config.id} (${testCases.length} testcases)`);
        totalProblems++;
        totalTestcases += testCases.length;
      } catch (err: any) {
        console.error(`[Sync Problems] ❌ Error processing ${item}:`, err.message);
        throw err; // Fail clearly if DB query fails during problem sync
      }
    }
  } catch (err: any) {
    console.error('[Sync Problems] ❌ Failed during problems synchronization:', err.message);
    throw err;
  }

  // Warn on duplicate problem order values
  try {
    const allProblems = await db.select({ id: problems.id, order: problems.order }).from(problems);
    const orderMap = new Map<number, string[]>();
    for (const p of allProblems) {
      if (!orderMap.has(p.order)) orderMap.set(p.order, []);
      orderMap.get(p.order)!.push(p.id);
    }
    for (const [order, ids] of orderMap.entries()) {
      if (ids.length > 1) {
        console.warn(`[Sync Problems] ⚠️ DUPLICATE ORDER ${order} detected for problems: ${ids.join(', ')}`);
      }
    }
  } catch (err: any) {
    console.warn('[Sync Problems] Could not validate problem order:', err.message);
  }

  return { totalProblems, totalTestcases };
}
