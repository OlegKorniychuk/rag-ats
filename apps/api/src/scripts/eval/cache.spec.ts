import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendScoreRecord,
  partitionJobs,
  prepareScoreCache,
  readScoreCache,
} from './cache.js';
import type { SampledPair } from './sample.js';
import {
  jobKey,
  type ScoreFailedRecord,
  type ScoreJobRecord,
  type ScoreJob,
  type ScoreOkRecord,
} from './score-record.js';

const pair = (personaId: string): SampledPair => ({
  vacancyId: 'v1',
  personaId,
  score: 50,
  band: 'partial',
  weight: 1,
  spotCheck: null,
});

const job = (personaId: string, run: 1 | 2 = 1): ScoreJob => ({
  pair: pair(personaId),
  mode: 'full_text',
  run,
});

const ok = (j: ScoreJob, overall = 70): ScoreOkRecord => ({
  key: jobKey(j),
  vacancyId: j.pair.vacancyId,
  personaId: j.pair.personaId,
  mode: j.mode,
  run: j.run,
  at: '2026-01-01T00:00:00.000Z',
  status: 'ok',
  overall,
  criteria: [],
  attempts: 1,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.001,
});

const failed = (j: ScoreJob): ScoreFailedRecord => ({
  key: jobKey(j),
  vacancyId: j.pair.vacancyId,
  personaId: j.pair.personaId,
  mode: j.mode,
  run: j.run,
  at: '2026-01-01T00:00:00.000Z',
  status: 'failed',
  failure: { kind: 'api', message: 'boom' },
});

describe('score cache', () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'score-cache-'));
    path = join(dir, 'nested', 'scores.jsonl');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads a missing file as empty', async () => {
    const cache = await readScoreCache(path);
    expect(cache.byKey.size).toBe(0);
    expect(cache.corruptLines).toBe(0);
  });

  it('creates the directory and round-trips appended records, one per line', async () => {
    await prepareScoreCache(path);
    await appendScoreRecord(path, ok(job('a')));
    await appendScoreRecord(path, failed(job('b')));
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    const cache = await readScoreCache(path);
    expect([...cache.byKey.keys()]).toEqual([
      jobKey(job('a')),
      jobKey(job('b')),
    ]);
  });

  it('survives concurrent appends without mixing lines', async () => {
    await prepareScoreCache(path);
    const jobs = Array.from({ length: 60 }, (_, i) => job(`p${i}`));
    await Promise.all(jobs.map((j) => appendScoreRecord(path, ok(j))));
    const cache = await readScoreCache(path);
    expect(cache.byKey.size).toBe(60);
    expect(cache.corruptLines).toBe(0);
  });

  it('tolerates a truncated last line and starts the next record on a new line', async () => {
    await prepareScoreCache(path);
    await appendScoreRecord(path, ok(job('a')));
    const full = JSON.stringify(ok(job('b')));
    await appendFile(path, full.slice(0, full.length - 10)); // killed mid-write

    const cache = await readScoreCache(path);
    expect(cache.byKey.size).toBe(1);
    expect(cache.corruptLines).toBe(1);

    await prepareScoreCache(path);
    await appendScoreRecord(path, ok(job('c')));
    const after = await readScoreCache(path);
    expect([...after.byKey.keys()]).toEqual([
      jobKey(job('a')),
      jobKey(job('c')),
    ]);
    expect(after.corruptLines).toBe(1);
  });

  it('ignores blank lines and objects that are not records', async () => {
    await writeFile(path.replace('nested/', ''), '\n{"a":1}\n\n');
    const cache = await readScoreCache(path.replace('nested/', ''));
    expect(cache.byKey.size).toBe(0);
    expect(cache.corruptLines).toBe(1);
  });

  it('keeps the newest line per key', async () => {
    await prepareScoreCache(path);
    await appendScoreRecord(path, failed(job('a')));
    await appendScoreRecord(path, ok(job('a'), 88));
    const cache = await readScoreCache(path);
    const record = cache.byKey.get(jobKey(job('a')))!;
    expect(record.status).toBe('ok');
    expect((record as ScoreOkRecord).overall).toBe(88);
  });
});

describe('partitionJobs', () => {
  const jobs = [job('a'), job('b'), job('c'), job('d')];
  const cache = {
    byKey: new Map<string, ScoreJobRecord>([
      [jobKey(jobs[0]), ok(jobs[0])],
      [jobKey(jobs[1]), failed(jobs[1])],
    ]),
    corruptLines: 0,
  };

  it('skips ok and failed lines by default', () => {
    const { cached, toRun } = partitionJobs(jobs, cache, false);
    expect(cached.map((r) => r.personaId)).toEqual(['a', 'b']);
    expect(toRun.map((j) => j.pair.personaId)).toEqual(['c', 'd']);
  });

  it('retries failed jobs only with retryFailed', () => {
    const { cached, toRun } = partitionJobs(jobs, cache, true);
    expect(cached.map((r) => r.personaId)).toEqual(['a']);
    expect(toRun.map((j) => j.pair.personaId)).toEqual(['b', 'c', 'd']);
  });

  it('treats run 1 and run 2 of a pair as separate jobs', () => {
    const { toRun } = partitionJobs([job('a', 1), job('a', 2)], cache, false);
    expect(toRun.map((j) => j.run)).toEqual([2]);
  });
});
