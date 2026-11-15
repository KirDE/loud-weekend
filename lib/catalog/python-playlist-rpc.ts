import { execFile } from 'node:child_process';

const MAX_BYTES = 8 * 1024 * 1024;

/** Pipe a single plan through the existing fenced provider adapter, never disk. */
export async function executePlaylistJson(
  executable: string, args: string[], value: unknown,
  options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; timeout: number },
): Promise<unknown> {
  const input = JSON.stringify(value);
  if (typeof input !== 'string' || Buffer.byteLength(input) > MAX_BYTES) throw new Error('Playlist request too large');
  return new Promise((resolve, reject) => {
    let inputError: Error | undefined;
    let timedOut = false;
    let diagnostics = '';
    let diagnosticBytes = 0;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const child = execFile(executable, args, { ...options, timeout: 0, maxBuffer: MAX_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (deadline) clearTimeout(deadline);
      if (timedOut) {
        reject(Object.assign(new Error('Playlist RPC deadline exceeded'), {
          code: 'ETIMEDOUT', stdout, stderr, playlistRpcTimedOut: true,
        })); return;
      }
      // Keep provider exit codes and bounded diagnostics for the existing retry policy.
      if (error) {
        reject(Object.assign(error, { stdout, stderr, playlistRpcTimedOut: timedOut && error.name !== 'AbortError' })); return;
      }
      if (inputError) { reject(inputError); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid playlist provider reply')); }
    });
    if (options.timeout > 0) {
      deadline = setTimeout(() => {
        timedOut = true;
        // A descendant can retain pipes after the worker exits. Do not await its
        // close event or accept a buffered JSON reply after the deadline.
        const killed = child.kill('SIGTERM');
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        reject(Object.assign(new Error('Playlist RPC deadline exceeded'), {
          code: 'ETIMEDOUT', killed, stderr: diagnostics, playlistRpcTimedOut: true,
        }));
      }, options.timeout);
    }
    child.stderr?.on('data', (chunk: string) => {
      diagnosticBytes += Buffer.byteLength(chunk);
      if (diagnosticBytes <= MAX_BYTES) diagnostics += chunk;
    });
    child.stdin!.on('error', error => { inputError = error; });
    child.stdin!.end(input);
  });
}
