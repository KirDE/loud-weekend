import { rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const privateReleasePaths = ['data', 'public/logos', 'public/offline'];

export async function stripDynamicRelease(root) {
  // Do not ship stale catalogue snapshots or import-only tools in current releases.
  for (const relative of privateReleasePaths) {
    await rm(path.join(root, relative), { recursive: true, force: true });
  }
  await assertDynamicReleaseAbsent(root);
}
export async function assertDynamicReleaseAbsent(root) {
  for (const relative of privateReleasePaths) {
    try { await lstat(path.join(root, relative)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Dynamic catalogue remains in release: ' + relative);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [root] = process.argv.slice(2);
    if (!root || process.argv.length !== 3) throw new Error();
    await stripDynamicRelease(root);
  } catch { console.error('DB-only release preparation rejected; archive validation failed'); process.exitCode = 1; }
}
