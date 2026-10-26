import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function checkIn(env, phase, send = fetch) {
  if (!['start', 'finish'].includes(phase)) throw Error('Invalid monitoring phase');
  const url = new URL(env.SENTRY_CRON_URL);
  if (url.protocol !== 'https:' || !/^o\d+\.ingest(?:\.[a-z]+)?\.sentry\.io$/.test(url.hostname) ||
      !/^\/api\/4511428438851584\/cron\/applysmooth-collector\/\w+\/$/.test(url.pathname) ||
      url.username || url.password || url.search || url.hash) throw Error('Invalid monitoring destination');
  if (!/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? ''))
    throw Error('Missing run identity');
  const id = createHash('sha256').update(`${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`).digest('hex').slice(0, 32);
  url.searchParams.set('check_in_id', id);
  url.searchParams.set('environment', 'collector-test');
  url.searchParams.set('status', phase === 'start' ? 'in_progress' : env.COLLECTOR_RESULT === 'success' ? 'ok' : 'error');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await send(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* Only sanitized failure messages may reach public logs. */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw Error('Sentry check-in failed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkIn(process.env, process.argv[2]).catch(() => {
    console.error('Sentry check-in failed; inspect monitor configuration');
    process.exitCode = 1;
  });
}
