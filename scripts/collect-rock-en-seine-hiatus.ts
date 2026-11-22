import { collectRockEnSeineHiatus } from '../lib/ingestion/adapters/rock-en-seine-collector.ts';

// Explicit operator invocation only. Preview never imports/opens a database.
const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === '--stage' && /^[a-zA-Z0-9_-]{1,100}$/.test(args[1])))) {
  console.error('Usage: node --import tsx scripts/collect-rock-en-seine-hiatus.ts [--stage EDITION_ID]');
  process.exitCode = 1;
} else {
  try {
    const { receipt, proposal } = await collectRockEnSeineHiatus();
    if (!args.length) console.log(JSON.stringify({ mode: 'preview', proposal }));
    else {
      const { createPrismaClient } = await import('../lib/prisma-client.mjs');
      const { stageRockEnSeineHiatus } = await import('../lib/ingestion/edition-lifecycle-proposal-store.ts');
      const db = createPrismaClient();
      try {
        await stageRockEnSeineHiatus(db, { ...receipt, editionId: args[1] });
        console.log(JSON.stringify({ mode: 'staged', reviewState: 'pending', observedAt: proposal.observedAt }));
      } finally { await db.$disconnect(); }
    }
  } catch {
    // Never dump response HTML, credentials, database diagnostics or headers.
    console.error('Lifecycle collection/staging failed; no confirmed new notice.');
    process.exitCode = 1;
  }
}
