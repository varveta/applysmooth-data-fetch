import { expect, it, vi } from "vitest";
import { manatal } from "./manatal";
import { loadManatalBoard } from "../../../ingest/lib/fetch-manatal";
import { validateTargets } from "../../../ingest/validate-targets";
import { runStateless } from "../../../ingest/stateless";
import { resolveMode } from "../../../ingest/source-pipeline";
const target = { source: "manatal" as const, tenant: "example", company: "Example" };
const raw = { id: 123, hash: "ABC123", position_name: "Data Engineer", description: '<p>' + 'Build reliable data systems. '.repeat(30) + '</p>',
  country: "United States", state: "Virginia", city: "Arlington", is_remote: true, contract_details: "full_time" };
const ok = (body: unknown) => ({ ok: true as const, status: 200, body, bytes: 100, attempts: 1 });
const page = (results: unknown[], count = results.length, next: string | null = null) => ({ count, results, next, previous: null });
it('preserves full description, numeric identity, employer and unknown dates', () => {
  expect(manatal.normalize(raw, 'example', 'Example')).toMatchObject({ sourceJobId: '123', company: 'Example', postedAt: null,
    sourceUpdatedAt: null, usEligibility: 'us', workMode: 'Remote', jobType: 'Full-time',
    applyUrl: 'https://www.careers-page.com/example/job/ABC123' });
  expect(manatal.normalize({...raw, country: '', state: '', city: ''}, 'example', 'Example').usEligibility).toBe('unknown');
  expect(manatal.normalize({...raw, description: 'a'.repeat(60000)}, 'example', 'Example').descriptionText).toHaveLength(60000);
});
it('follows complete same-tenant pagination and preserves counts', async () => {
  const next = 'https://api.manatal.com/open/v3/career-page/example/jobs/?page=2';
  const get = vi.fn(async (url: string) => ok(url === next ? page([{...raw,id:124,hash:'XYZ123'}], 2) : page([raw],2,next)));
  const r = await loadManatalBoard(target, get);
  expect(r.body).toHaveLength(2);expect(r.attempts).toBe(2);expect(r.discovery.policy).toBe('observations');
});
it('rejects foreign pagination before a second request', async () => {
  for (const next of ['https://attacker.example/jobs/', 'https://api.manatal.com/open/v3/career-page/other/jobs/?page=2',
    'https://user@api.manatal.com/open/v3/career-page/example/jobs/?page=2']) {
    const get=vi.fn(async()=>ok(page([raw],2,next)));
    await expect(loadManatalBoard(target,get)).rejects.toThrow('pagination');expect(get).toHaveBeenCalledTimes(1);
  }
});
it('rejects partial, conflicting, repeated and failed pages rather than publishing a subset', async () => {
  const next='https://api.manatal.com/open/v3/career-page/example/jobs/?page=2';
  for(const body of [page([],2),page([raw,raw],2),page([{...raw,hash:'../unsafe'}]),{error:'not found'}])
    await expect(loadManatalBoard(target,async()=>ok(body))).rejects.toThrow();
  for(const second of [ok(page([raw],2)),ok(page([{...raw,id:124,hash:'XYZ123'}],3)),
    {ok:false as const,status:429,error:'HTTP 429',attempts:2,retryable:true}]) {
    let n=0;await expect(loadManatalBoard(target,async()=>++n===1?ok(page([raw],2,next)):second)).rejects.toThrow();
  }
});
it('reports real gating counts with no writes and refuses publication activation', async()=>{
 const r=await validateTargets({targets:[target]}, {get:async()=>ok(page([raw,{...raw,id:124,hash:'ZZZ123',country:'Germany',city:'Berlin',state:''}]))});
 expect(r.boards[0]).toMatchObject({success:true,fetched_count:2,accepted_count:1,rejected_count:1,reason_counts:{not_us:1},us_eligible_count:1,unknown_posting_date_count:2,known_recent_posting_count:0});
 expect(r.writes).toBe(0);
 expect(()=>resolveMode('manatal','publish','["manatal"]')).toThrow(/TEST-only/);
 const call=vi.fn(async()=>({}));
 await expect(runStateless({targets:[target],client:{metrics:{requests:0,payload_bytes:0},call}})).rejects.toThrow(/TEST-only/);
 expect(call).not.toHaveBeenCalled();
});
