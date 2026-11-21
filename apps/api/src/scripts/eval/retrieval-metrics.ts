/** The ranking metrics shared by the search and the find-matches eval. */
import {
  mean,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  type Gains,
  type Maybe,
} from './metrics.js';

export interface RankMetrics {
  p5: Maybe;
  p10: Maybe;
  r10: Maybe;
  r20: Maybe;
  ndcg10: Maybe;
}

/** P@5, P@10, R@10, R@20 and nDCG@10 of a ranked id list. */
export function rankMetrics(
  ranked: readonly string[],
  gains: Gains,
): RankMetrics {
  return {
    p5: precisionAtK(ranked, gains, 5),
    p10: precisionAtK(ranked, gains, 10),
    r10: recallAtK(ranked, gains, 10),
    r20: recallAtK(ranked, gains, 20),
    ndcg10: ndcgAtK(ranked, gains, 10),
  };
}

/** Mean of each metric over rows; a row with an undefined metric is skipped for it. */
export function meanRankMetrics(rows: readonly RankMetrics[]): RankMetrics {
  return {
    p5: mean(rows.map((r) => r.p5)),
    p10: mean(rows.map((r) => r.p10)),
    r10: mean(rows.map((r) => r.r10)),
    r20: mean(rows.map((r) => r.r20)),
    ndcg10: mean(rows.map((r) => r.ndcg10)),
  };
}
