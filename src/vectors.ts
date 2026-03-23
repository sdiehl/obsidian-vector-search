export interface NoteEntry {
  v: number[];
  title: string;
  mtime: number;
}

export interface EmbeddingsIndex {
  model: string;
  dimension: number;
  indexed_at: string;
  notes: Record<string, NoteEntry>;
}

export interface SimilarNote {
  path: string;
  title: string;
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function findSimilar(
  queryVec: number[],
  index: EmbeddingsIndex,
  excludePath?: string,
  limit = 20,
): SimilarNote[] {
  const results: SimilarNote[] = [];
  for (const [path, entry] of Object.entries(index.notes)) {
    if (path === excludePath) continue;
    const score = cosineSimilarity(queryVec, entry.v);
    results.push({ path, title: entry.title, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
