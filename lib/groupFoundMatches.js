export function groupFoundMatches(found) {
  if (!Array.isArray(found)) return [];

  const groups = new Map();
  for (const match of found) {
    if (typeof match?.word !== "string") continue;

    const word = match.word.trim().replace(/\s+/gu, " ");
    if (!word) continue;

    const key = word.normalize("NFKC").toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.patternCount += 1;
    } else {
      groups.set(key, { key, word, patternCount: 1 });
    }
  }

  return [...groups.values()];
}
