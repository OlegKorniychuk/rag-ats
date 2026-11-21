/**
 * The generated Markdown report of the eval. `renderReportRaw` builds the
 * text, `renderReport` runs it through prettier so `prettier --check` never
 * flags the file (CI checks docs). Numbers are to 3 decimals, confidence
 * intervals read `estimate [lo, hi]`, and a part that was not run says so.
 */
import { SCORING_MODES, type ScoringMode } from './score-record.js';
import type {
  BaselineAggregate,
  ModeAggregate,
  SliceName,
} from './aggregate.js';
import type { ConfidenceInterval, Maybe } from './metrics.js';
import { formatText } from './layout.js';
import type { SearchMetrics } from './retrieval-search.js';
import type { RankMetrics } from './retrieval-metrics.js';
import { BANDS } from '../synth/spot-check.js';

const NA = 'n/a';
const NOT_RUN = 'not run';

const num = (x: Maybe | undefined): string =>
  x === null || x === undefined || Number.isNaN(x) ? NA : x.toFixed(3);
const whole = (x: Maybe | undefined): string =>
  x === null || x === undefined ? NA : String(Math.round(x));
const usd = (x: number | null | undefined): string =>
  x === null || x === undefined ? NA : `$${x.toFixed(4)}`;

/** `0.512 [0.401, 0.610]`; just the estimate when there is no interval. */
export function ciText(interval: ConfidenceInterval): string {
  if (interval.estimate === null) return NA;
  if (interval.lo === null || interval.hi === null) {
    return num(interval.estimate);
  }
  return `${num(interval.estimate)} [${num(interval.lo)}, ${num(interval.hi)}]`;
}

/** A cell of a table: pipes escaped, newlines flattened. */
const cell = (value: string | number): string =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();

function table(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string[] {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    '',
  ];
}

const modeCols = (
  report: BaselineAggregate,
): Array<{ mode: ScoringMode; agg: ModeAggregate }> =>
  SCORING_MODES.flatMap((mode) => {
    const agg = report.scoring?.perMode[mode];
    return agg ? [{ mode, agg }] : [];
  });

const notRunModes = (report: BaselineAggregate): ScoringMode[] =>
  SCORING_MODES.filter((m) => !report.scoring?.perMode[m]);

const rankRow = (m: RankMetrics): string[] => [
  num(m.p5),
  num(m.p10),
  num(m.r10),
  num(m.r20),
  num(m.ndcg10),
];
const RANK_HEAD = ['P@5', 'P@10', 'R@10', 'R@20', 'nDCG@10'] as const;

const searchRow = (m: SearchMetrics): string[] => [...rankRow(m), num(m.rr)];

// --- Sections ----------------------------------------------------------------

function headline(report: BaselineAggregate): string[] {
  const out = ['## Headline', ''];
  const modes = modeCols(report);
  if (modes.length === 0) {
    out.push(`Scoring: ${NOT_RUN}.`, '');
  } else {
    out.push(
      'Score agreement with the rule, run 1, 95% bootstrap CIs (sample only; the population view is the weighted pair).',
      '',
      ...table(
        [
          'Mode',
          'n',
          'Spearman rho',
          'MAE',
          'Cohen kappa',
          'Weighted MAE',
          'Weighted band agreement',
        ],
        modes.map(({ mode, agg }) => [
          mode,
          agg.agreement.n,
          ciText(agg.agreement.spearman),
          ciText(agg.agreement.mae),
          ciText(agg.agreement.kappa),
          num(agg.agreement.weightedMae),
          num(agg.agreement.weightedBandAgreement),
        ]),
      ),
    );
    for (const mode of notRunModes(report)) {
      out.push(`Scoring \`${mode}\`: ${NOT_RUN}.`, '');
    }
    const paired = report.scoring?.paired;
    if (paired) {
      out.push(
        `full_text minus rag over ${paired.pairs} pairs: rho ${ciText(paired.spearman)}, MAE ${ciText(paired.mae)}.`,
        '',
      );
    }
  }

  const retrieval = report.retrieval;
  if (!retrieval) {
    out.push(`Retrieval: ${NOT_RUN}.`, '');
  } else {
    out.push(
      ...table(
        ['Retrieval', ...RANK_HEAD, 'Results'],
        [
          [
            `Search (${retrieval.search.queries.length} queries)`,
            ...rankRow(retrieval.search.metrics),
            num(retrieval.search.returned),
          ],
          ...(['criteria', 'whole_text'] as const).map((mode) => [
            `Matches, ${mode}`,
            ...rankRow(retrieval.matches[mode].metrics),
            num(retrieval.matches[mode].returned),
          ]),
        ],
      ),
      `G5, weak-band share of the top 10: criteria ${num(retrieval.g5.criteria.pooledWeakShare)}, whole_text ${num(retrieval.g5.whole_text.pooledWeakShare)}.`,
      '',
    );
  }
  const g4 = modeCols(report).map(
    ({ mode, agg }) =>
      `${mode} ${num(agg.g4.creditedShare)} credited / ${num(agg.g4.citedGithubShare)} cite github (of ${agg.g4.mapped} mapped)`,
  );
  if (g4.length > 0) out.push(`G4, github-only tags: ${g4.join('; ')}.`, '');
  const reviews = report.scoring?.reviews ?? [];
  if (reviews.length > 0) {
    out.push(
      `Citation relevance (supports + weak over labelled): ${reviews
        .map(
          (r) =>
            `${r.mode} ${num(r.relevanceRate)} (${r.labelled}/${r.total} labelled)`,
        )
        .join('; ')}.`,
      '',
    );
  }
  return out;
}

function sampleDesign(report: BaselineAggregate): string[] {
  const s = report.sample;
  const weight = (band: 'strong' | 'partial' | 'weak'): string =>
    s.sampled[band] === 0 ? NA : num(s.population[band] / s.sampled[band]);
  return [
    '## Sample design',
    '',
    `Seed ${s.seed}, ${s.weak} weak pairs drawn at random, ${s.noise} pairs scored a second time per mode, ${s.pairs} pairs in the sample (${s.spotCheckPairs} carry Dude's labels).`,
    '',
    ...table(
      ['Rule band', 'Population', 'Sampled', 'Weight'],
      BANDS.map((b) => [b, s.population[b], s.sampled[b], weight(b)]),
    ),
    '- Scoring is on a stratified sample: every strong and partial pair, a random part of the weak pairs, and every spot-check pair not already in. The weak band is under-sampled, so each pair carries its band weight (population over sampled).',
    '- Weighted MAE and weighted band agreement use those weights and estimate the whole population of pairs. Spearman rho, Cohen kappa, per-band MAE and the plain MAE are over the sample only, where the weak band is under-represented.',
    '- Find matches ranks the whole candidate pool for every vacancy: no applicant exclusion (the app hides candidates who already applied) and no cap of 10 (so recall@20 is measurable). Relevance there comes from the rule bands: strong 1, partial 0.5, weak 0.',
    '',
  ];
}

function perModeTable(
  report: BaselineAggregate,
  headers: readonly string[],
  row: (agg: ModeAggregate) => Array<string | number>,
): string[] {
  const modes = modeCols(report);
  if (modes.length === 0) return [`${NOT_RUN}.`, ''];
  return [
    ...table(
      ['Mode', ...headers],
      modes.map(({ mode, agg }) => [mode, ...row(agg)]),
    ),
    ...notRunModes(report).flatMap((m) => [`\`${m}\`: ${NOT_RUN}.`, '']),
  ];
}

function agreement(report: BaselineAggregate): string[] {
  const out = ['## Score agreement with the rule', ''];
  if (modeCols(report).length === 0) return [...out, `${NOT_RUN}.`, ''];
  out.push(
    'Run 1, ok scores, against the rule score and band. Mean signed error is positive when the scorer runs higher than the rule.',
    '',
    ...perModeTable(
      report,
      [
        'Scored',
        'Failed',
        'Not run',
        'Mean signed error',
        'Band agreement',
        'Quadratic kappa',
        'Weighted band agreement',
      ],
      (a) => [
        a.agreement.n,
        a.coverage.failed,
        a.coverage.missing,
        num(a.agreement.meanSignedError),
        num(a.agreement.bandAgreement),
        num(a.agreement.quadraticKappa),
        num(a.agreement.weightedBandAgreement),
      ],
    ),
    'MAE per rule band:',
    '',
    ...perModeTable(
      report,
      BANDS.map((b) => `${b} MAE (n)`),
      (a) =>
        BANDS.map(
          (b) =>
            `${num(a.agreement.perBandMae[b])} (${a.agreement.perBandN[b]})`,
        ),
    ),
  );
  return out;
}

function vsDude(report: BaselineAggregate): string[] {
  const out = ["## Against Dude's labels", ''];
  const modes = modeCols(report);
  if (modes.length === 0) return [...out, `${NOT_RUN}.`, ''];
  out.push(
    'Band agreement on the spot-check pairs. The rule against Dude is shown on the same pairs, and over all labelled pairs of the sample, for reference.',
    '',
    ...table(
      [
        'Mode',
        'Pairs',
        'Scorer vs Dude kappa',
        'Scorer exact',
        'Rule vs Dude kappa (same pairs)',
        'Rule vs Dude kappa (all labelled)',
      ],
      modes.map(({ mode, agg }) =>
        agg.vsDude
          ? [
              mode,
              agg.vsDude.pairs,
              num(agg.vsDude.scorer.kappa),
              num(agg.vsDude.scorer.exactAgreement),
              num(agg.vsDude.rule.kappa),
              num(agg.vsDude.ruleAll.kappa),
            ]
          : [mode, 0, NA, NA, NA, NA],
      ),
    ),
  );
  return out;
}

function paired(report: BaselineAggregate): string[] {
  const out = ['## full_text vs rag', ''];
  const p = report.scoring?.paired;
  if (!p) {
    return [...out, `${NOT_RUN} (needs both modes).`, ''];
  }
  return [
    ...out,
    `Paired bootstrap of full_text minus rag over the ${p.pairs} pairs scored in both modes. A CI that excludes 0 is a difference beyond sample noise. For MAE, negative means full_text is closer to the rule.`,
    '',
    ...table(
      ['Statistic', 'full_text minus rag'],
      [
        ['Spearman rho', ciText(p.spearman)],
        ['MAE', ciText(p.mae)],
        ['Cohen kappa', ciText(p.kappa)],
      ],
    ),
  ];
}

function noise(report: BaselineAggregate): string[] {
  return [
    '## Run-to-run noise',
    '',
    'Pairs scored twice in the same mode. The test-retest MAE is the mean absolute difference between the two runs; step 12 is judged against it.',
    '',
    ...perModeTable(
      report,
      [
        'Pairs',
        'Test-retest MAE (mean abs delta)',
        'Max abs delta',
        'Mean signed delta',
        'Spearman rho',
      ],
      (a) => [
        a.noise.pairs,
        num(a.noise.meanAbsDelta),
        whole(a.noise.maxAbsDelta),
        num(a.noise.meanSignedDelta),
        num(a.noise.spearman),
      ],
    ),
  ];
}

function grounding(report: BaselineAggregate): string[] {
  const out = [
    '## Grounding',
    '',
    'Jobs of run 1 and run 2. First pass: scores that needed the in-job retry plus grounding failures, over ok plus grounding failures. After retry: grounding failures over the same. API and parse failures are counted apart and left out of both rates. A score above 0 that still cites no evidence after the retry is set to 0, not failed: the last two columns count those scores and criteria.',
    '',
    ...perModeTable(
      report,
      [
        'Jobs',
        'Ok',
        'Ok after retry',
        'Grounding failures',
        'API (excluded)',
        'Parse (excluded)',
        'First-pass failure rate',
        'After-retry failure rate',
        'Scores with a zeroed criterion',
        'Zeroed criteria',
      ],
      (a) => [
        a.grounding.jobs,
        a.grounding.ok,
        a.grounding.okAfterRetry,
        a.grounding.groundingFailures,
        a.grounding.apiFailures,
        a.grounding.parseFailures,
        num(a.grounding.firstPassFailureRate),
        num(a.grounding.afterRetryFailureRate),
        a.grounding.zeroedScores,
        a.grounding.zeroedCriteria,
      ],
    ),
  ];
  const modes = modeCols(report);
  const buckets = Object.keys(modes[0]?.agg.grounding.buckets ?? {});
  if (modes.length > 0 && buckets.length > 0) {
    out.push(
      'Failure causes (a failed job counts once in every bucket it has):',
      '',
      ...table(
        ['Bucket', ...modes.map((m) => m.mode)],
        buckets.map((b) => [
          b,
          ...modes.map(
            (m) =>
              m.agg.grounding.buckets[
                b as keyof typeof m.agg.grounding.buckets
              ],
          ),
        ]),
      ),
    );
  }
  return out;
}

function cost(report: BaselineAggregate): string[] {
  return [
    '## Cost',
    '',
    `Per ok score (run 1 and run 2); chat only, embeddings are in the metered total. Metered spend over ${report.runs.length} logged invocation(s): ${usd(report.meteredUsd)}. ${report.pricingCaveat}`,
    '',
    ...perModeTable(
      report,
      [
        'Ok scores',
        'Mean input tokens',
        'Mean output tokens',
        'Mean USD',
        'Total USD',
      ],
      (a) => [
        a.cost.okScores,
        whole(a.cost.meanInputTokens),
        whole(a.cost.meanOutputTokens),
        usd(a.cost.meanCostUsd),
        usd(a.cost.totalCostUsd),
      ],
    ),
  ];
}

function g4(report: BaselineAggregate): string[] {
  return [
    '## G4: GitHub evidence in full_text scoring',
    '',
    'Over ok run-1 scores: every tag the rule counts as met only through GitHub, mapped to the scorer criteria that mention it (by alias). Tags no criterion mentions are counted apart. Shares are over the mapped tags.',
    '',
    ...perModeTable(
      report,
      [
        'Tags',
        'Mapped',
        'Unmapped',
        'Credited',
        'Credited share',
        'Cite github',
        'Cite github share',
      ],
      (a) => [
        a.g4.tags,
        a.g4.mapped,
        a.g4.unmapped,
        a.g4.credited,
        num(a.g4.creditedShare),
        a.g4.citedGithub,
        num(a.g4.citedGithubShare),
      ],
    ),
  ];
}

const SLICE_LABEL: Record<SliceName, string> = {
  uk: 'Ukrainian CVs',
  keywordStuffers: 'Keyword stuffers',
  injection: 'Injection personas',
  rest: 'The rest',
};

function slices(report: BaselineAggregate): string[] {
  const modes = modeCols(report);
  const out = [
    '## Slices',
    '',
    'MAE against the rule on run 1. A persona can be in more than one of the first three slices; the rest is none of them.',
    '',
  ];
  if (modes.length === 0) return [...out, `${NOT_RUN}.`, ''];
  return [
    ...out,
    ...table(
      [
        'Slice',
        ...modes.flatMap((m) => [
          `${m.mode} n`,
          `${m.mode} MAE`,
          `${m.mode} signed error`,
        ]),
      ],
      (Object.keys(SLICE_LABEL) as SliceName[]).map((s) => [
        SLICE_LABEL[s],
        ...modes.flatMap((m) => [
          m.agg.slices[s].n,
          num(m.agg.slices[s].mae),
          num(m.agg.slices[s].meanSignedError),
        ]),
      ]),
    ),
  ];
}

function reviews(report: BaselineAggregate): string[] {
  const list = report.scoring?.reviews ?? [];
  const out = ['## Citation review', ''];
  if (list.length === 0) {
    return [
      ...out,
      `${NOT_RUN} (no filled-in review-<mode>.md in the label directory).`,
      '',
    ];
  }
  return [
    ...out,
    'Relevance rate: supports + weak over the labelled citations.',
    '',
    ...table(
      [
        'Mode',
        'Citations',
        'Labelled',
        'Supports',
        'Weak',
        'Irrelevant',
        'Supports share',
        'Relevance rate',
      ],
      list.map((r) => [
        r.mode,
        r.total,
        r.labelled,
        r.supports,
        r.weak,
        r.irrelevant,
        num(r.supportsShare),
        num(r.relevanceRate),
      ]),
    ),
  ];
}

function searchSection(report: BaselineAggregate): string[] {
  const out = ['## Candidate search', ''];
  const r = report.retrieval;
  if (!r) return [...out, `${NOT_RUN}.`, ''];
  const s = r.settings.search;
  out.push(
    `The production search: ${s.chunkLimit} nearest chunks, floor ${num(s.floor)}, up to ${s.maxResults} candidates. Relevant counts 1, partially relevant 0.5; MRR counts only fully relevant.`,
    '',
    ...table(
      [...RANK_HEAD, 'MRR', 'Results'],
      [[...searchRow(r.search.metrics), num(r.search.returned)]],
    ),
    'Floor sweep (the same nearest chunks, re-ranked at other floors):',
    '',
    ...table(
      ['Floor', ...RANK_HEAD, 'MRR', 'Results'],
      r.search.sweep.map((row) => [
        num(row.floor),
        ...searchRow(row.metrics),
        num(row.returned),
      ]),
    ),
    'Per query:',
    '',
    ...table(
      ['Query', 'Relevant', 'Partial', 'Results', ...RANK_HEAD, 'MRR'],
      r.search.queries.map((q) => [
        `${q.queryId}: ${q.query}`,
        q.relevant,
        q.partiallyRelevant,
        q.returned,
        ...searchRow(q.metrics),
      ]),
    ),
  );
  return out;
}

function matchesSection(report: BaselineAggregate): string[] {
  const out = ['## Find matches', ''];
  const r = report.retrieval;
  if (!r) return [...out, `${NOT_RUN}.`, ''];
  const m = r.settings.matches;
  out.push(
    `Both modes over the whole pool of ${m.maxCandidates} candidates, no applicant exclusion, no cap of 10. Floors: criteria ${num(m.criteriaFloor)}, whole_text ${num(m.wholeTextFloor)}. Relevance from the rule bands: strong 1, partial 0.5, weak 0.`,
    '',
    ...table(
      [
        'Mode',
        ...RANK_HEAD,
        'Mean results',
        'G5 weak share (mean)',
        'G5 weak share (pooled)',
      ],
      (['criteria', 'whole_text'] as const).map((mode) => [
        mode,
        ...rankRow(r.matches[mode].metrics),
        num(r.matches[mode].returned),
        num(r.g5[mode].meanWeakShare),
        num(r.g5[mode].pooledWeakShare),
      ]),
    ),
  );
  for (const mode of ['criteria', 'whole_text'] as const) {
    out.push(
      `Per vacancy, ${mode}:`,
      '',
      ...table(
        [
          'Vacancy',
          'Strong',
          'Partial',
          'Weak',
          'Results',
          ...RANK_HEAD,
          'Weak in top 10',
        ],
        r.matches[mode].vacancies.map((v) => [
          `${v.vacancyId}: ${v.title}`,
          v.bands.strong,
          v.bands.partial,
          v.bands.weak,
          v.returned,
          ...rankRow(v.metrics),
          v.weakInTop10,
        ]),
      ),
    );
  }
  out.push('### G5: worst weak-band examples', '');
  for (const mode of ['criteria', 'whole_text'] as const) {
    const worst = r.g5[mode].worst;
    out.push(`${mode}:`, '');
    if (worst.length === 0) {
      out.push('No weak-band candidate in any top 10.', '');
      continue;
    }
    out.push(
      ...table(
        ['Persona', 'Vacancy', 'Rank', 'Score', 'Matched criteria', 'Snippet'],
        worst.map((e) => [
          e.personaId,
          `${e.vacancyId}: ${e.title}`,
          e.rank,
          num(e.score),
          e.matchedCriteria
            .map((c) => `${c.criterion} (${num(c.similarity)})`)
            .join('; ') || '-',
          e.snippet ?? '-',
        ]),
      ),
    );
  }
  return out;
}

function runLog(report: BaselineAggregate): string[] {
  const out = ['## Run log', ''];
  if (report.runs.length === 0) return [...out, `${NOT_RUN}.`, ''];
  return [
    ...out,
    ...table(
      [
        'Finished',
        'Part',
        'Modes',
        'Seed',
        'Limit',
        'Spent',
        'Stopped',
        'Done',
        'Failed',
        'Skipped',
        'Not started',
      ],
      report.runs.map((r) => [
        r.finishedAt,
        r.part,
        r.modes.join(', ') || '-',
        r.seed,
        r.limit ?? '-',
        usd(r.spentUsd),
        r.stopped ?? 'no',
        r.scoring?.done ?? '-',
        r.scoring?.failed ?? '-',
        r.scoring?.skipped ?? '-',
        r.scoring?.notStarted ?? '-',
      ]),
    ),
  ];
}

/** The report as plain Markdown (not yet through prettier). */
export function renderReportRaw(report: BaselineAggregate): string {
  const notes: string[] = [];
  if ((report.scoring?.unmatchedRecords ?? 0) > 0) {
    notes.push(
      `${report.scoring?.unmatchedRecords} cached score(s) belong to pairs outside this sample (another seed or weak count) and were left out.`,
    );
  }
  return [
    `# Eval baseline: ${report.label}`,
    '',
    `Generated ${report.generatedAt}. Generated by \`npm run eval\`; the data is in \`${report.label}.json\` and the label directory. Do not edit.`,
    '',
    ...(notes.length > 0 ? [...notes.map((n) => `Note: ${n}`), ''] : []),
    ...headline(report),
    ...sampleDesign(report),
    ...agreement(report),
    ...vsDude(report),
    ...paired(report),
    ...noise(report),
    ...grounding(report),
    ...cost(report),
    ...g4(report),
    ...slices(report),
    ...reviews(report),
    ...searchSection(report),
    ...matchesSection(report),
    ...runLog(report),
  ].join('\n');
}

/** The report, formatted by prettier with the repo's config. */
export const renderReport = (
  report: BaselineAggregate,
  path = 'report.md',
): Promise<string> => formatText(path, renderReportRaw(report), 'markdown');
