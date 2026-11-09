import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { publicationFingerprint } from '@/lib/jobs-collector/publication-contract';
import golden from '@/lib/jobs-collector/__fixtures__/publication-fingerprint-v1.json';
import { boardIdentities } from './board-identities';
import { collectorClient } from './collector-client';
import { planDeltaBatches } from './delta-publish';
import { prepareBoard, runStateless, splitBatches, type StatelessCatalogRow } from '../stateless';
import { greenhouseFixture } from '../synthetic-fixtures';
const target = { source: 'greenhouse' as const, tenant: 'example', company: 'Example' };
const endpoint = 'https://collector.example.test/api/jobs-collector';
const now = new Date('2026-11-09T00:00:00Z');
const listing = { jobs: [{ ...greenhouseFixture, content: 'SQL Python engineering platform. '.repeat(400) }] };
const empty = { ...target, complete: true, identities: [] };
const row = prepareBoard(target, listing, now, empty).rows[0];
const snapshot = (fingerprint: string | null = publicationFingerprint(row), version = 1) => ({
  source: target.source, tenant: target.tenant, complete: true, capabilities: { delta_publish_versions: [1] },
  identities: [{ id: row.id, source_job_id: row.source_job_id, first_seen_at: row.first_seen_at, duplicate_posting_ids: row.duplicate_posting_ids,
    publish_fingerprint_version: fingerprint ? version : null, publish_fingerprint: fingerprint, mark_seen_eligible: fingerprint !== null }],
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());

it('uses full rows for null, mismatched, unsupported or ineligible fingerprints', () => {
  const identity = { run_id: randomUUID(), source: target.source, tenant: target.tenant };
  for (const state of [snapshot(null), snapshot('b'.repeat(64)), snapshot(publicationFingerprint(row), 2),
    { ...snapshot(), identities: snapshot().identities.map(x => ({ ...x, mark_seen_eligible: false })) }]) {
    expect(planDeltaBatches(splitBatches(identity, [row]), boardIdentities(state, target.source, target.tenant), true)[0].request.operation).toBe('publish_batch');
  }
  expect(planDeltaBatches(splitBatches(identity, [row]), boardIdentities(snapshot(), target.source, target.tenant), false)[0].request.operation).toBe('publish_batch');
});
it('keeps full and compact batch numbers contiguous and fallback envelopes within limits', () => {
  const second = { ...row, id: 'job_' + 'b'.repeat(32), source_job_id: 'new', observed_source_job_id: 'new' };
  const identity = { run_id: randomUUID(), source: target.source, tenant: target.tenant };
  const plans = planDeltaBatches(splitBatches(identity, [row, second]), boardIdentities(snapshot(), target.source, target.tenant), true);
  expect(plans.map(x => x.request.operation)).toEqual(['publish_batch', 'mark_seen_batch']);
  expect(plans.map(x => x.request.batch_no)).toEqual([0, 1]);
  expect(plans.map(x => x.fallback.rows.length)).toEqual([1, 1]);
});

async function simulate(mode: 'full' | 'delta', behavior: 'normal' | 'stale' | 'lost-ack' | 'conflict' | 'unsupported' = 'normal') {
  const bodies: string[] = [], logs: string[] = [];
  let observations = 0, identityCalls = 0;
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== endpoint) return json(listing);
    const text = String(init?.body); bodies.push(text);
    const body = JSON.parse(text);
    if (body.operation === 'board_identities') { identityCalls++; return json(behavior === 'unsupported' ? { ...snapshot(), capabilities: undefined } : snapshot(identityCalls > 1 ? null : publicationFingerprint(row))); }
    if (body.operation === 'mark_seen_batch') {
      observations++;
      if (behavior === 'stale' && observations === 1) return json({ error: 'stale_publish_fingerprint' }, 409);
      if (behavior === 'conflict') return json({ error: 'collector_conflict' }, 409);
      if (behavior === 'lost-ack' && observations === 1) throw new TypeError('network lost after commit');
      return json({ accepted: body.items.length, results: body.items.map((x: { id: string }) => ({ id: x.id, outcome: 'unchanged' })) });
    }
    if (body.operation === 'publish_batch') return json({ accepted: body.rows.length, results: body.rows.map((x: { id: string }) => ({ id: x.id, outcome: 'unchanged' })) });
    if (body.operation === 'complete_board') return json({ complete: true, missing: 0, withdrawn: 0, marked_uncertain: 0, guard: 'none' });
    throw new Error('Unexpected operation');
  });
  vi.stubGlobal('fetch', fetch);
  const client = collectorClient({ endpoint, token: 'x'.repeat(64), baseDelayMs: 0 });
  const work = runStateless({ targets: [target], now, client, deltaBoards: new Set(mode === 'delta' ? ['greenhouse:example'] : []), log: line => logs.push(line) });
  return { result: await work, bodies, logs, identityCalls };
}
it('sends at least 90% fewer total request-body bytes for an unchanged second snapshot with identical outcomes', async () => {
  const legacy = await simulate('full'), delta = await simulate('delta');
  expect(delta.result.payload_bytes).toBeLessThanOrEqual(legacy.result.payload_bytes * 0.1);
  const outcome = (logs: string[]) => logs.map(x => JSON.parse(x)).find(x => x.board === 'greenhouse:example' && x.stage === 'complete');
  expect(outcome(delta.logs).outcomes).toEqual(outcome(legacy.logs).outcomes);
  expect(outcome(delta.logs).withdrawn).toBe(outcome(legacy.logs).withdrawn);
  expect(outcome(delta.logs).compact_rows).toBe(1);
  console.info(JSON.stringify({ local_unchanged_fixture: true, legacy_request_bytes: legacy.result.payload_bytes, delta_request_bytes: delta.result.payload_bytes,
    reduction_percent: 100 * (1 - delta.result.payload_bytes / legacy.result.payload_bytes) }));
});
it('refreshes history once after atomic stale rejection and uses full fallback at the same number', async () => {
  const result = await simulate('delta', 'stale');
  const requests = result.bodies.map(x => JSON.parse(x));
  expect(requests.map(x => x.operation)).toEqual(['board_identities', 'mark_seen_batch', 'board_identities', 'publish_batch', 'complete_board']);
  expect(requests[1].batch_no).toBe(requests[3].batch_no);
  expect(requests[4].batches_expected).toBe(1);
  expect(result.identityCalls).toBe(2);
});
it('replays identical compact bytes after a lost acknowledgment instead of changing the payload', async () => {
  const result = await simulate('delta', 'lost-ack');
  const compact = result.bodies.filter(x => JSON.parse(x).operation === 'mark_seen_batch');
  expect(compact).toHaveLength(2); expect(compact[0]).toBe(compact[1]); expect(result.identityCalls).toBe(1);
});
it('fails on unrelated conflicts and negotiates legacy mode when capabilities are absent', async () => {
  await expect(simulate('delta', 'conflict')).rejects.toThrow('1 board(s) failed');
  const result = await simulate('delta', 'unsupported');
  expect(result.bodies.map(x => JSON.parse(x).operation)).toEqual(['board_identities', 'publish_batch', 'complete_board']);
});
it('keeps canonical contract fixture accepted by client-side full preflight', () => {
  expect(publicationFingerprint(golden.row as StatelessCatalogRow)).toBe(golden.expected);
});

it('uses the one refreshed manifest to downgrade later known-stale batches without renumbering', async () => {
  const source = { jobs: ['Engineering Manager', 'Security Analyst'].map((title, index) => ({
    ...greenhouseFixture, id: 100 + index, internal_job_id: 100 + index, title,
    content: 'SQL Python engineering platform. '.repeat(1000),
  })) };
  const rows = prepareBoard(target, source, now, empty).rows;
  expect(rows).toHaveLength(2);
  const sent: Array<{ operation: string; batch_no?: number; batches_expected?: number }> = [];
  let identities = 0, compact = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== endpoint) return json(source);
    const body = JSON.parse(String(init?.body)); sent.push(body);
    if (body.operation === 'board_identities') {
      identities++;
      return json({ source: target.source, tenant: target.tenant, complete: true, capabilities: { delta_publish_versions: [1] },
        identities: rows.map(row => ({ ...row, publish_fingerprint_version: identities === 1 ? 1 : null,
          publish_fingerprint: identities === 1 ? publicationFingerprint(row) : null, mark_seen_eligible: identities === 1 })) });
    }
    if (body.operation === 'mark_seen_batch') { compact++; return json({ error: 'stale_publish_fingerprint' }, 409); }
    if (body.operation === 'publish_batch') return json({ accepted: body.rows.length, results: body.rows.map((row: { id: string }) => ({ id: row.id, outcome: 'unchanged' })) });
    return json({ complete: true, missing: 0, withdrawn: 0, marked_uncertain: 0, guard: 'none' });
  }));
  await runStateless({ targets: [target], now, client: collectorClient({ endpoint, token: 'x'.repeat(64), baseDelayMs: 0 }),
    deltaBoards: new Set(['greenhouse:example']), log: () => {} });
  expect(identities).toBe(2); expect(compact).toBe(1);
  expect(sent.filter(x => x.operation === 'publish_batch').map(x => x.batch_no)).toEqual([0, 1]);
  expect(sent.at(-1)).toMatchObject({ operation: 'complete_board', batches_expected: 2 });
});
