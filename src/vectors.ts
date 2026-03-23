import {
  create,
  insert,
  remove,
  search,
  save,
  load,
  count,
  type AnyOrama,
} from "@orama/orama";

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

// Orama doesn't return vector values in results, so we keep a parallel
// map for the "similar to current note" lookup.
const vecMap = new Map<string, number[]>();
const mtimeMap = new Map<string, number>();

export async function createDb(): Promise<void> {
  db = await create({ schema: SCHEMA });
  vecMap.clear();
  mtimeMap.clear();
}

export async function noteCount(): Promise<number> {
  if (!db) return 0;
  return count(db);
}

export async function upsertNote(
  path: string,
  title: string,
  content: string,
  mtime: number,
  embedding: number[],
): Promise<void> {
  if (!db) await createDb();
  // Remove existing entry
  try {
    const existing = await search(db!, {
      term: path,
      properties: ["path"],
      exact: true,
      limit: 1,
    });
    for (const hit of existing.hits) {
      await remove(db!, hit.id);
    }
  } catch {
    // not found
  }
  await insert(db!, { path, title, content, mtime, embedding });
  vecMap.set(path, embedding);
  mtimeMap.set(path, mtime);
}

export async function removeNote(path: string): Promise<void> {
  if (!db) return;
  try {
    const existing = await search(db, {
      term: path,
      properties: ["path"],
      exact: true,
      limit: 1,
    });
    for (const hit of existing.hits) {
      await remove(db, hit.id);
    }
  } catch {
    // not found
  }
  vecMap.delete(path);
  mtimeMap.delete(path);
}

export async function findSimilar(
  queryVec: number[],
  excludePath: string | undefined,
  limit: number,
  minScore: number,
): Promise<SimilarNote[]> {
  if (!db) return [];
  const results = await search(db, {
    mode: "vector",
    vector: { value: queryVec, property: "embedding" },
    similarity: minScore,
    limit: limit + 1,
  });
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

export async function saveDb(): Promise<{ orama: any; vecs: [string, number[]][]; mtimes: [string, number][] }> {
  const orama = db ? await save(db) : null;
  return {
    orama,
    vecs: [...vecMap.entries()],
    mtimes: [...mtimeMap.entries()],
  };
}

export async function loadDb(data: any): Promise<void> {
  db = await create({ schema: SCHEMA });
  vecMap.clear();
  mtimeMap.clear();

  if (data.orama) {
    await load(db, data.orama);
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

export async function clearDb(): Promise<void> {
  await createDb();
}

export async function getAllPaths(): Promise<Set<string>> {
  return new Set(vecMap.keys());
}
