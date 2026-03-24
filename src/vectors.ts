import { create, insert, remove, search, save, load, count, type AnyOrama } from "@orama/orama";

const SCHEMA = {
  path: "string" as const,
  title: "string" as const,
  content: "string" as const,
  mtime: "number" as const,
  embedding: "vector[384]" as const,
};

export interface SimilarNote {
  path: string;
  title: string;
  score: number;
}

let db: AnyOrama | null = null;

const vecMap = new Map<string, number[]>();
const mtimeMap = new Map<string, number>();

export function createDb(): void {
  db = create({ schema: SCHEMA }) as AnyOrama;
  vecMap.clear();
  mtimeMap.clear();
}

export function noteCount(): number {
  if (!db) return 0;
  return count(db);
}

export function upsertNote(
  path: string,
  title: string,
  content: string,
  mtime: number,
  embedding: number[],
): void {
  if (!db) createDb();
  try {
    const existing = search(db!, {
      term: path,
      properties: ["path"],
      exact: true,
      limit: 1,
    }) as { hits: { id: string }[] };
    for (const hit of existing.hits) {
      void remove(db!, hit.id);
    }
  } catch {
    // not found
  }
  void insert(db!, { path, title, content, mtime, embedding });
  vecMap.set(path, embedding);
  mtimeMap.set(path, mtime);
}

export function removeNote(path: string): void {
  if (!db) return;
  try {
    const existing = search(db, {
      term: path,
      properties: ["path"],
      exact: true,
      limit: 1,
    }) as { hits: { id: string }[] };
    for (const hit of existing.hits) {
      void remove(db, hit.id);
    }
  } catch {
    // not found
  }
  vecMap.delete(path);
  mtimeMap.delete(path);
}

export function findSimilar(
  queryVec: number[],
  excludePath: string | undefined,
  limit: number,
  minScore: number,
): SimilarNote[] {
  if (!db) return [];
  const results = search(db, {
    mode: "vector",
    vector: { value: queryVec, property: "embedding" },
    similarity: minScore,
    limit: limit + 1,
  }) as { hits: { document: Record<string, unknown>; score: number }[] };
  return results.hits
    .filter((h) => h.document.path !== excludePath)
    .slice(0, limit)
    .map((h) => ({
      path: h.document.path as string,
      title: h.document.title as string,
      score: h.score,
    }));
}

export function getNoteMtime(path: string): number | null {
  return mtimeMap.get(path) ?? null;
}

export function getNoteVec(path: string): number[] | null {
  return vecMap.get(path) ?? null;
}

export function saveDb(): {
  orama: unknown;
  vecs: [string, number[]][];
  mtimes: [string, number][];
} {
  const orama = db ? save(db) : null;
  return {
    orama,
    vecs: [...vecMap.entries()],
    mtimes: [...mtimeMap.entries()],
  };
}

export function loadDb(data: {
  orama?: unknown;
  vecs?: [string, number[]][];
  mtimes?: [string, number][];
}): void {
  db = create({ schema: SCHEMA }) as AnyOrama;
  vecMap.clear();
  mtimeMap.clear();

  if (data.orama) {
    load(db, data.orama as Parameters<typeof load>[1]);
  }
  if (data.vecs) {
    for (const [path, vec] of data.vecs) {
      vecMap.set(path, vec);
    }
  }
  if (data.mtimes) {
    for (const [path, mtime] of data.mtimes) {
      mtimeMap.set(path, mtime);
    }
  }
}

export function clearDb(): void {
  createDb();
}

export function getAllPaths(): Set<string> {
  return new Set(vecMap.keys());
}
