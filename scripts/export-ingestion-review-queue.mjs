#!/usr/bin/env node
import { runCli } from '../lib/ingestion/review-queue.mjs';

process.exitCode = await runCli(process.argv.slice(2), process.env, {
  connect: async (url) => {
    const { createPrismaClient } = await import('../lib/prisma-client.mjs');
    return createPrismaClient({ url, log: [] });
  },
  output: (json) => process.stdout.write(json),
});
