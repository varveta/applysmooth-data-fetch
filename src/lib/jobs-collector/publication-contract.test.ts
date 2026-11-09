import { expect, it } from 'vitest';
import { canonicalJson, publicationFingerprint } from './publication-contract';
import fixture from './__fixtures__/publication-fingerprint-v1.json';
it('matches the cross-repository v1 golden digest', () => {
  expect(publicationFingerprint(fixture.row)).toBe(fixture.expected);
  expect(publicationFingerprint(Object.fromEntries(Object.entries(fixture.row).reverse()))).toBe(
    fixture.expected,
  );
});
it('covers input content, dates, attribution and ownership while ignoring first-seen scan time', () => {
  for (const key of [
    'title',
    'company',
    'department',
    'description',
    'location_text',
    'source_job_id',
    'observed_source_job_id',
    'attribution_name',
  ]) {
    expect(publicationFingerprint({ ...fixture.row, [key]: 'Changed-value' })).not.toBe(
      fixture.expected,
    );
  }
  for (const key of ['source_url', 'apply_url', 'attribution_url'])
    expect(
      publicationFingerprint({ ...fixture.row, [key]: 'https://changed.example/jobs' }),
    ).not.toBe(fixture.expected);
  for (const key of ['posted_at', 'source_updated_at', 'source_expires_at'])
    expect(publicationFingerprint({ ...fixture.row, [key]: '2026-11-02T00:00:00Z' })).not.toBe(
      fixture.expected,
    );
  expect(publicationFingerprint({ ...fixture.row, first_seen_at: '2026-11-03T00:00:00Z' })).toBe(
    fixture.expected,
  );
  expect(publicationFingerprint({ ...fixture.row, source_expires_at: null })).toBe(
    fixture.expected,
  );
  expect(publicationFingerprint({ ...fixture.row, content_hash: 'b'.repeat(64) })).not.toBe(
    fixture.expected,
  );
});
it('canonicalizes object keys and explicit sets, preserving ordered arrays and exact Unicode', () => {
  expect(canonicalJson({ z: -0, a: ['é', 1] })).toBe('{"a":["é",1],"z":0}');
  expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']));
  expect(canonicalJson('é')).not.toBe(canonicalJson('e\u0301'));
  expect(publicationFingerprint({ ...fixture.row, duplicate_posting_ids: ['b', 'a'] })).toBe(
    publicationFingerprint({ ...fixture.row, duplicate_posting_ids: ['a', 'b'] }),
  );
  for (const value of [undefined, NaN, Infinity, new Date(), { missing: undefined }])
    expect(() => canonicalJson(value)).toThrow();
});
