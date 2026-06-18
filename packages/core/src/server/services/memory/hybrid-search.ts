import { DEFAULT_SCORE_THRESHOLD } from "./embedding";

const DEFAULT_VECTOR_WEIGHT = 0.7;
const DEFAULT_TEXT_WEIGHT = 0.3;

export interface RankedRow {
  id: string;
  content: string;
  score: number;
}

export interface HybridRankConfig {
  limit: number;
  vectorWeight?: number;
  textWeight?: number;
  threshold?: number;
}

/**
 * Fuse cosine-distance vector hits with Postgres full-text rank hits into a
 * single weighted, thresholded, sorted ranking. This is the one place the
 * memory store and the transcript store share: both feed in their raw vector
 * rows (carrying `distance`) and text rows (carrying `rank`), keyed by chunk
 * `id`, and receive back the top `limit` chunk ids with a fused `score`.
 *
 * Vector score is `1 - distance` clamped to [0, ∞)+; text score is the row's
 * rank normalized against the maximum rank in the text result set. The fused
 * score is `vectorWeight * vectorScore + textWeight * textScore`, rows below
 * `threshold` are dropped, and the remainder is sorted descending and sliced.
 */
export function hybridRank(
  vectorRows: Array<{ id: string; content: string; distance: number }>,
  textRows: Array<{ id: string; content: string; rank: number }>,
  config: HybridRankConfig,
): RankedRow[] {
  const vectorWeight = config.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const textWeight = config.textWeight ?? DEFAULT_TEXT_WEIGHT;
  const threshold = config.threshold ?? DEFAULT_SCORE_THRESHOLD;

  const maxRank =
    textRows.reduce((max, row) => Math.max(max, Number(row.rank) || 0), 0) || 1;

  const combined = new Map<
    string,
    { id: string; content: string; vectorScore: number; textScore: number }
  >();

  for (const row of vectorRows) {
    combined.set(row.id, {
      id: row.id,
      content: row.content,
      vectorScore: Math.max(0, 1 - Number(row.distance)),
      textScore: 0,
    });
  }

  for (const row of textRows) {
    const textScore = Math.max(0, Number(row.rank) / maxRank);
    const existing = combined.get(row.id);
    if (existing) {
      existing.textScore = textScore;
    } else {
      combined.set(row.id, {
        id: row.id,
        content: row.content,
        vectorScore: 0,
        textScore,
      });
    }
  }

  return Array.from(combined.values())
    .map((row) => ({
      id: row.id,
      content: row.content,
      score: vectorWeight * row.vectorScore + textWeight * row.textScore,
    }))
    .filter((row) => row.score >= threshold)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, config.limit);
}

/**
 * Render a query embedding as the pgvector literal used in `embedding <=> '...'`
 * cosine-distance expressions, with fixed precision for stable SQL text.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((v) => Number(v).toFixed(6)).join(",")}]`;
}
