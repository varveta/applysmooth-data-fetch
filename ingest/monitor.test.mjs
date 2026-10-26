import { it, expect, vi } from 'vitest';
import { checkIn } from './monitor.mjs';
const env = { SENTRY_CRON_URL: 'https://o123.ingest.us.sentry.io/api/4511428438851584/cron/applysmooth-collector/testkey/', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' };
it('pairs start and finish, and only explicitly successful jobs report success', async () => {
  const send = vi.fn(async () => new Response('{}'));
  for (const [phase, result] of [['start', undefined], ['finish', 'success'], ['finish', 'failure'], ['finish', 'cancelled'], ['finish', undefined]])
    await checkIn({ ...env, COLLECTOR_RESULT: result }, phase, send);
  const urls = send.mock.calls.map(call => call[0]);
  expect(urls.map(url => url.searchParams.get('status'))).toEqual(['in_progress','ok','error','error','error']);
  expect(new Set(urls.map(url => url.searchParams.get('check_in_id'))).size).toBe(1);
  await checkIn({...env, GITHUB_RUN_ATTEMPT:'2'}, 'start', send);
  expect(send.mock.calls[5][0].searchParams.get('check_in_id')).not.toBe(urls[0].searchParams.get('check_in_id'));
});
it('rejects foreign destinations and invalid run identity before transmitting', async () => {
  const send = vi.fn();
  await expect(checkIn({...env, SENTRY_CRON_URL: env.SENTRY_CRON_URL.replace('sentry.io','attacker.test')}, 'start', send)).rejects.toThrow();
  await expect(checkIn({...env, GITHUB_RUN_ID:''}, 'start', send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
