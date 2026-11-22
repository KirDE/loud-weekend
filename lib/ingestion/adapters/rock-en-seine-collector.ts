import { observeRockEnSeineHiatus, ROCK_EN_SEINE_HOME } from './rock-en-seine-hiatus.ts';

/** One anonymous GET, no redirects/retries/cookies or source-health writes. Raw
 * HTML exists only in memory for re-extraction at the durable staging boundary. */
export async function collectRockEnSeineHiatus(fetchImpl: typeof fetch = fetch) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); void reader?.cancel().catch(() => {});
      reject(new Error('Lifecycle collection deadline exceeded'));
    }, 20_000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(ROCK_EN_SEINE_HOME, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { accept: 'text/html', 'cache-control': 'no-cache',
          'user-agent': 'LoudWeekendBot/1.1 (+https://loudweekend.eu/; public festival-data monitor)' },
      });
      const contentType = response.headers.get('content-type') ?? '';
      // Parse declarations before comparing: a negative lookahead can backtrack
      // over whitespace and incorrectly reject a valid padded UTF-8 value.
      const charsets = [...contentType.matchAll(/;\s*charset\b([^;]*)/gi)];
      const utf8 = charsets.every(([, parameter]) => {
        const value = parameter.match(/^\s*=\s*(?:"([^"]*)"|([^"\s;]+))\s*$/);
        return value !== null && (value[1] ?? value[2]).trim().toLowerCase() === 'utf-8';
      });
      if (response.status !== 200 || response.url !== ROCK_EN_SEINE_HOME
        || !/^text\/html(?:\s*;|$)/i.test(contentType)
        || !utf8
        || !response.body) throw new Error('Lifecycle source HTTP/identity/type mismatch');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) throw new Error('Lifecycle source exceeds size limit');
        chunks.push(value);
      }
      const html = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      const observedAt = new Date().toISOString();
      const receipt = { html, requestedUrl: ROCK_EN_SEINE_HOME, finalUrl: response.url, status: response.status, observedAt };
      return { receipt, proposal: observeRockEnSeineHiatus(html, observedAt, receipt) };
    })()]);
  } finally {
    clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {});
  }
}
