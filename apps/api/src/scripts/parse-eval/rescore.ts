import { allChecksFailed, runChecks } from './checks.js';
import type { Manifest } from './manifest.js';
import type { EvalResult } from './result.js';

/**
 * Re-runs the checks of a saved eval against the current manifest, keeping
 * the stored profiles, usage and cost, so changed expectations can be applied
 * to earlier runs without new LLM calls. CVs no longer in the manifest are kept
 * unchanged.
 */
export function rescore(result: EvalResult, manifest: Manifest): EvalResult {
  return {
    ...result,
    cvs: result.cvs.map((cv) => {
      const entry = manifest.cvs.find((m) => m.id === cv.id);
      if (!entry) return cv;
      return {
        ...cv,
        runs: cv.runs.map((run) => {
          const summary = run.profile
            ? runChecks(run.profile, entry.expect)
            : allChecksFailed(entry.expect);
          return {
            ...run,
            checks: summary.results,
            checksPassed: summary.passed,
            checksTotal: summary.total,
          };
        }),
      };
    }),
  };
}
