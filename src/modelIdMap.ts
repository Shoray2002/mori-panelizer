/** ModelId -> set of localIds, the universal selection currency in fragments v3. */
export type ModelIdMap = { [modelId: string]: Set<number> };

/** Merge one ModelIdMap's localIds into another, in place. */
export function mergeInto(target: ModelIdMap, source: ModelIdMap) {
  for (const [modelId, set] of Object.entries(source)) {
    const into = (target[modelId] ??= new Set());
    for (const id of set) into.add(id);
  }
}
