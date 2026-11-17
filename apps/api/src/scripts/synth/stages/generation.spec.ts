import 'reflect-metadata'; // shared/cli.js pulls in decorated env config
import { jest } from '@jest/globals';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePersonas } from '../personas.js';
import { exists, SYNTH_DIR, writeJson } from '../io.js';
import { loadDraftData } from '../test-data.js';
import {
  FAKE_USAGE,
  FakeLlm,
  goodCvOutput,
  goodGithubOutput,
  goodVacancyOutput,
  parsed,
  type Responder,
} from '../test-llm.js';
import type { CvContent } from '../cv-content.js';
import type { GenerationRunRecord } from '../generation.js';
import type { PersonaSpec, Taxonomy, VacancySpec } from '../types.js';
import { runCvs } from './cvs.js';
import { runGithub } from './github.js';
import { runVacancies } from './vacancies.js';

jest.setTimeout(60_000);

let taxonomy: Taxonomy;
let vacancies: VacancySpec[];
let sample: PersonaSpec[];

beforeAll(async () => {
  ({ taxonomy, vacancies } = await loadDraftData());
  const all = generatePersonas(taxonomy, vacancies, 1).personas;
  const pick = (pred: (p: PersonaSpec) => boolean) => all.find(pred)!;
  const chosen = [
    pick(
      (p) =>
        p.github !== null && p.skills.some((s) => s.evidence === 'github_only'),
    ),
    pick((p) => p.flags.includes('injection')),
    pick((p) => p.language === 'uk'),
    pick((p) => p.github !== null && p.id !== all[0].id && p.language === 'en'),
  ];
  sample = [...new Map(chosen.map((p) => [p.id, p])).values()];
  // A persona without GitHub, to check the github stage ignores it.
  const noGh = pick((p) => p.github === null && !sample.includes(p));
  sample.push(noGh);
});

/** Answers by prompt: finds the persona by its name in the user message. */
function goodResponder(): Responder {
  return (params) => {
    if (params.schemaName === 'synthetic_cv') {
      const p = sample.find((s) =>
        params.user.includes(`Candidate: ${s.name}`),
      )!;
      return parsed(goodCvOutput(p, taxonomy));
    }
    if (params.schemaName === 'synthetic_github_profile') {
      const p = sample.find((s) =>
        params.user.includes(`Developer: ${s.name}`),
      )!;
      return parsed(goodGithubOutput(p, taxonomy));
    }
    const v = vacancies.find((x) => params.user.startsWith(`Role: ${x.id}\n`))!;
    return parsed(goodVacancyOutput(v, taxonomy));
  };
}

const log = async (dir: string): Promise<GenerationRunRecord[]> =>
  JSON.parse(await readFile(join(dir, 'generation-log.json'), 'utf8')).runs;

describe('LLM stages', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'synth-gen-'));
    for (const f of ['taxonomy.json', 'vacancies.draft.json']) {
      await copyFile(join(SYNTH_DIR, f), join(dir, f));
    }
    await writeJson(join(dir, 'personas.json'), { seed: 1, personas: sample });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const readCv = async (id: string): Promise<CvContent> =>
    JSON.parse(await readFile(join(dir, 'cvs', `${id}.json`), 'utf8'));

  describe('cvs', () => {
    it('writes one CvContent per persona and logs the run', async () => {
      const llm = new FakeLlm(goodResponder());
      await runCvs([], dir, { llm });
      expect((await readdir(join(dir, 'cvs'))).sort()).toEqual(
        sample.map((p) => `${p.id}.json`).sort(),
      );
      expect(llm.calls).toHaveLength(sample.length);

      const inj = sample.find((p) => p.flags.includes('injection'))!;
      expect((await readCv(inj.id)).injection).toContain('PWNED-SKILL');
      expect((await readCv(sample[0].id)).injection).toBeNull();
      expect((await readCv(sample[0].id)).personaId).toBe(sample[0].id);

      const [record] = await log(dir);
      expect(record).toMatchObject({
        stage: 'cvs',
        model: 'fake-model',
        calls: sample.length,
        inputTokens: FAKE_USAGE.inputTokens * sample.length,
        outputTokens: FAKE_USAGE.outputTokens * sample.length,
        retries: 0,
        failures: [],
        remaining: [],
        stopped: null,
        maxUsd: 2,
      });
      expect(record.costUsd).toBeCloseTo(0.003 * sample.length, 6);
      expect(record.pricing.inputPerMillion).toBe(0.75);
      expect(record.pricingCaveat).toMatch(/third-party/);
      expect(typeof record.timestamp).toBe('string');
    });

    it('skips existing files, honours --only and --force, and appends to the log', async () => {
      const [a, b, c] = sample;
      await runCvs(['--only', `${a.id},${b.id}`], dir, {
        llm: new FakeLlm(goodResponder()),
      });
      expect(await exists(join(dir, 'cvs', `${c.id}.json`))).toBe(false);

      const second = new FakeLlm(goodResponder());
      await runCvs(['--only', `${a.id},${c.id}`], dir, { llm: second });
      expect(second.calls).toHaveLength(1); // a exists, c is new
      expect(second.calls[0].user).toContain(`Candidate: ${c.name}`);

      const third = new FakeLlm(goodResponder());
      await runCvs(['--force', a.id], dir, { llm: third });
      expect(
        third.calls.map((x) => x.user.match(/Candidate: (.*)/)![1]).sort(),
      ).toEqual([a.name, ...sample.slice(3).map((p) => p.name)].sort());

      const fourth = new FakeLlm(goodResponder());
      await runCvs(['--force', 'all'], dir, { llm: fourth });
      expect(fourth.calls).toHaveLength(sample.length);

      const noop = new FakeLlm(goodResponder());
      await runCvs([], dir, { llm: noop });
      expect(noop.calls).toHaveLength(0);
      expect((await log(dir)).map((r) => r.stage)).toEqual([
        'cvs',
        'cvs',
        'cvs',
        'cvs',
      ]);
    });

    it('rejects unknown ids in --only and --force', async () => {
      const llm = new FakeLlm(goodResponder());
      await expect(runCvs(['--only', 'nope'], dir, { llm })).rejects.toThrow(
        /nope/,
      );
      await expect(runCvs(['--force', 'nope'], dir, { llm })).rejects.toThrow(
        /nope/,
      );
      expect(llm.calls).toHaveLength(0);
    });

    it('retries with the problems as feedback, then succeeds', async () => {
      const p = sample[0];
      const missing = p.skills.find(
        (s) => s.evidence === 'cv_role' && s.tag !== 'git',
      )!;
      const label = taxonomy.tags.find((t) => t.tag === missing.tag)!.label;
      const responder: Responder = (_params, i) => {
        const out = goodCvOutput(p, taxonomy);
        if (i === 0) {
          out.roles.forEach((r) => {
            r.bullets = r.bullets.map((b) => b.replaceAll(label, 'tools'));
          });
        }
        return parsed(out);
      };
      const llm = new FakeLlm(responder);
      await runCvs(['--only', p.id], dir, { llm });
      expect(llm.calls).toHaveLength(2);
      expect(llm.calls[0].user).not.toContain('rejected by an automatic check');
      expect(llm.calls[1].user).toContain('rejected by an automatic check');
      expect(llm.calls[1].user).toContain(`"${label}" must appear by name`);
      expect((await readCv(p.id)).personaId).toBe(p.id);
      const [record] = await log(dir);
      expect(record).toMatchObject({ calls: 2, retries: 1, failures: [] });
    });

    it('records a permanent failure: 5 calls, feedback twice then fresh, no file, throws', async () => {
      const p = sample[0];
      const llm = new FakeLlm(() => {
        const out = goodCvOutput(p, taxonomy);
        out.headline = ''; // always fails the "must not be empty" check
        return parsed(out);
      });
      await expect(runCvs(['--only', p.id], dir, { llm })).rejects.toThrow(
        new RegExp(`${p.id}.*must not be empty`, 's'),
      );
      expect(llm.calls).toHaveLength(5);
      const withFeedback = llm.calls.map((c) =>
        c.user.includes('rejected by an automatic check'),
      );
      expect(withFeedback).toEqual([false, true, true, false, false]);
      expect(await exists(join(dir, 'cvs', `${p.id}.json`))).toBe(false);

      const [record] = await log(dir);
      expect(record.failures).toEqual([
        { id: p.id, problems: ['Headline and summary must not be empty.'] },
      ]);
      expect(record.retries).toBe(4);
      expect(record.generated).toEqual([]);
    });

    it('keeps the good personas when one fails', async () => {
      const bad = sample[1];
      const llm = new FakeLlm((params) => {
        const base = goodResponder()(params, 0);
        if (params.user.includes(`Candidate: ${bad.name}`)) {
          return parsed({ ...goodCvOutput(bad, taxonomy), roles: [] });
        }
        return base;
      });
      await expect(runCvs([], dir, { llm })).rejects.toThrow(bad.id);
      expect(await exists(join(dir, 'cvs', `${bad.id}.json`))).toBe(false);
      expect(await exists(join(dir, 'cvs', `${sample[0].id}.json`))).toBe(true);
    });

    it('treats refusals and API errors as failed attempts', async () => {
      const p = sample[0];
      const llm = new FakeLlm((params, i) => {
        if (i === 0)
          return { kind: 'refusal', refusal: 'no', usage: FAKE_USAGE };
        if (i === 1) throw new Error('socket hang up');
        return parsed(goodCvOutput(p, taxonomy));
      });
      await runCvs(['--only', p.id], dir, { llm });
      expect(llm.calls).toHaveLength(3);
      expect(llm.calls[2].user).toContain(
        'The model call failed: socket hang up',
      );
    });

    it('aborts the run on an auth error', async () => {
      const llm = new FakeLlm(() => {
        throw Object.assign(new Error('bad key'), { status: 401 });
      });
      await expect(runCvs([], dir, { llm })).rejects.toThrow(/HTTP 401/);
      expect(llm.calls.length).toBeLessThanOrEqual(4); // one per worker, no retries
    });

    it('stops before the next call once the cap would be exceeded', async () => {
      const expensive = {
        ...FAKE_USAGE,
        inputTokens: 800_000,
        outputTokens: 0,
      }; // $0.60
      const llm = new FakeLlm((params) => {
        const p = sample.find((s) =>
          params.user.includes(`Candidate: ${s.name}`),
        )!;
        return parsed(goodCvOutput(p, taxonomy), expensive);
      });
      await runCvs(['--concurrency', '1', '--max-usd', '0.601'], dir, { llm });
      expect(llm.calls).toHaveLength(1);
      const [record] = await log(dir);
      expect(record.stopped).toBe('budget');
      expect(record.generated).toEqual([sample[0].id]);
      expect(record.remaining).toEqual(sample.slice(1).map((p) => p.id));
      expect(record.costUsd).toBeCloseTo(0.6, 6);
      expect(await readdir(join(dir, 'cvs'))).toEqual([`${sample[0].id}.json`]);
    });

    it('makes no call when even one call does not fit', async () => {
      const llm = new FakeLlm(goodResponder());
      await runCvs(['--max-usd', '0.001'], dir, { llm });
      expect(llm.calls).toHaveLength(0);
      const [record] = await log(dir);
      expect(record.remaining).toHaveLength(sample.length);
    });

    it('dry run needs no client, writes nothing and prints an estimate', async () => {
      await runCvs(['--dry-run'], dir);
      expect(await exists(join(dir, 'cvs'))).toBe(false);
      expect(await exists(join(dir, 'generation-log.json'))).toBe(false);
      const out = (console.log as jest.Mock).mock.calls.flat().join('\n');
      expect(out).toContain('Dry run (cvs)');
      expect(out).toContain(`to generate: ${sample.length}`);
      expect(out).toMatch(/estimated cost: \$\d/);
    });

    it('rejects bad flags', async () => {
      await expect(
        runCvs(['--concurrency', '0', '--dry-run'], dir),
      ).rejects.toThrow(/--concurrency/);
      await expect(
        runCvs(['--max-usd', 'x', '--dry-run'], dir),
      ).rejects.toThrow(/--max-usd/);
    });
  });

  describe('github', () => {
    const ghPersonas = (): PersonaSpec[] => sample.filter((p) => p.github);

    it('writes a fixture per persona with a profile only', async () => {
      const llm = new FakeLlm(goodResponder());
      await runGithub([], dir, { llm });
      const files = (await readdir(join(dir, 'github'))).sort();
      expect(files).toEqual(
        ghPersonas()
          .map((p) => `${p.github!.username}.json`)
          .sort(),
      );
      expect(llm.calls).toHaveLength(ghPersonas().length);
      const p = ghPersonas()[0];
      const fixture = JSON.parse(
        await readFile(
          join(dir, 'github', `${p.github!.username}.json`),
          'utf8',
        ),
      );
      expect(fixture.user.login).toBe(p.github!.username);
      expect(fixture.repos.length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(fixture.readmes)).toHaveLength(fixture.repos.length);
      expect((await log(dir))[0]).toMatchObject({
        stage: 'github',
        failures: [],
      });
    });

    it('skips existing, honours --force, rejects personas without a profile', async () => {
      await runGithub([], dir, { llm: new FakeLlm(goodResponder()) });
      const again = new FakeLlm(goodResponder());
      await runGithub([], dir, { llm: again });
      expect(again.calls).toHaveLength(0);

      const forced = new FakeLlm(goodResponder());
      await runGithub(['--force', ghPersonas()[0].id], dir, { llm: forced });
      expect(forced.calls).toHaveLength(1);

      const noGh = sample.find((p) => !p.github)!;
      await expect(
        runGithub(['--only', noGh.id], dir, { llm: forced }),
      ).rejects.toThrow(noGh.id);
    });

    it('fails a persona whose github_only skill never shows up', async () => {
      const p = ghPersonas()[0];
      const llm = new FakeLlm(() => {
        const out = goodGithubOutput(p, taxonomy);
        out.repos.forEach((r) => {
          r.description = 'Nothing special.';
          r.language = null;
        });
        return parsed(out);
      });
      await expect(runGithub(['--only', p.id], dir, { llm })).rejects.toThrow(
        /must appear by name/,
      );
      expect(llm.calls).toHaveLength(5);
      expect(await exists(join(dir, 'github'))).toBe(false);
    });

    it('dry run needs no client', async () => {
      await runGithub(['--dry-run'], dir);
      expect(await exists(join(dir, 'github'))).toBe(false);
      expect((console.log as jest.Mock).mock.calls.flat().join('\n')).toContain(
        `to generate: ${ghPersonas().length}`,
      );
    });
  });

  describe('vacancies', () => {
    it('writes vacancies.json in the draft structure with re-rendered text', async () => {
      const llm = new FakeLlm((params) => {
        const v = vacancies.find((x) =>
          params.user.startsWith(`Role: ${x.id}\n`),
        )!;
        const out = goodVacancyOutput(v, taxonomy);
        out.title = `${v.title} (Rewritten)`;
        return parsed(out);
      });
      await runVacancies([], dir, { llm });
      expect(llm.calls).toHaveLength(vacancies.length);
      const written = JSON.parse(
        await readFile(join(dir, 'vacancies.json'), 'utf8'),
      ) as VacancySpec[];
      expect(written.map((v) => v.id)).toEqual(vacancies.map((v) => v.id));
      for (const [i, v] of written.entries()) {
        const draft = vacancies[i];
        expect(v.title).toBe(`${draft.title} (Rewritten)`);
        expect(
          v.requirements.map(({ id, kind, tags, minYears }) => ({
            id,
            kind,
            tags,
            minYears,
          })),
        ).toEqual(
          draft.requirements.map(({ id, kind, tags, minYears }) => ({
            id,
            kind,
            tags,
            minYears,
          })),
        );
        expect(v.text.startsWith(v.title)).toBe(true);
        for (const r of v.requirements) expect(v.text).toContain(`- ${r.text}`);
      }
      expect((await log(dir))[0]).toMatchObject({
        stage: 'vacancies',
        calls: 10,
      });
    });

    it('skips when vacancies.json exists unless --force', async () => {
      await runVacancies([], dir, { llm: new FakeLlm(goodResponder()) });
      const again = new FakeLlm(goodResponder());
      await runVacancies([], dir, { llm: again });
      expect(again.calls).toHaveLength(0);
      await runVacancies(['--force'], dir, { llm: again });
      expect(again.calls).toHaveLength(vacancies.length);
    });

    it('writes nothing when a vacancy fails or the budget stops the run', async () => {
      const failing = new FakeLlm((params) => {
        const v = vacancies.find((x) =>
          params.user.startsWith(`Role: ${x.id}\n`),
        )!;
        const out = goodVacancyOutput(v, taxonomy);
        if (v.id === 'frontend') out.requirements[0].id = 'made-up';
        return parsed(out);
      });
      await expect(runVacancies([], dir, { llm: failing })).rejects.toThrow(
        /frontend/,
      );
      expect(await exists(join(dir, 'vacancies.json'))).toBe(false);

      const capped = new FakeLlm(goodResponder());
      await runVacancies(['--max-usd', '0.001'], dir, { llm: capped });
      expect(capped.calls).toHaveLength(0);
      expect(await exists(join(dir, 'vacancies.json'))).toBe(false);
    });

    it('dry run needs no client', async () => {
      await runVacancies(['--dry-run'], dir);
      expect(await exists(join(dir, 'vacancies.json'))).toBe(false);
      expect((console.log as jest.Mock).mock.calls.flat().join('\n')).toContain(
        'to generate: 10',
      );
    });
  });
});
