import test from "node:test";
import assert from "node:assert/strict";
import { groupFoundMatches } from "../lib/groupFoundMatches.js";

test("groups repeated labels and case/compatibility variants into one pattern chip", () => {
  const grouped = groupFoundMatches([
    { word: "nigga", count: 1 },
    { word: "nigga", count: 1 },
    { word: " NIGGA ", count: 2 },
    { word: "ｎｉｇｇａ", count: 1 },
    { word: "nig", count: 1 },
  ]);

  assert.deepEqual(grouped, [
    { key: "nigga", word: "nigga", patternCount: 4 },
    { key: "nig", word: "nig", patternCount: 1 },
  ]);
});

test("returns no groups for invalid input and ignores empty labels", () => {
  assert.deepEqual(groupFoundMatches(null), []);
  assert.deepEqual(groupFoundMatches([{ word: "  ", count: 1 }, {}, null]), []);
});
