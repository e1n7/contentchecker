import test from "node:test";
import assert from "node:assert/strict";
import { handleAnalyzeContentRequest } from "../lib/analyzeContent.js";

function makeRequest({ method = "POST", body, headers = {} } = {}) {
  return new Request("https://contentchecker-d1-migrated.example.workers.dev/api/analyze-content", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeFakeD1(patterns) {
  const rateBuckets = new Map();
  const slots = new Set();

  function prepare(sql) {
    const statement = {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async all() {
        if (this.sql.includes("FROM ban_words")) {
          return { results: patterns.map((word) => ({ word })) };
        }
        return { results: [] };
      },
      async run() {
        if (this.sql.includes("DELETE FROM analyze_content_slots")) slots.delete(this.values[0]);
        return { success: true, meta: { changes: 1 } };
      },
    };
    return statement;
  }

  return {
    prepare,
    async batch(statements) {
      const operation = statements[1];
      if (operation.sql.includes("INSERT INTO analyze_content_slots")) {
        const [slotId] = operation.values;
        slots.add(slotId);
        return [{ success: true, results: [] }, { success: true, results: [{ slot_id: slotId }] }];
      }
      if (operation.sql.includes("INSERT INTO rate_limit_buckets")) {
        const [bucketKey] = operation.values;
        const existing = rateBuckets.get(bucketKey);
        const row = existing
          ? { window_started: existing.window_started, request_count: existing.request_count + 1 }
          : { window_started: new Date().toISOString(), request_count: 1 };
        rateBuckets.set(bucketKey, row);
        return [{ success: true, results: [] }, { success: true, results: [row] }];
      }
      throw new Error("Unexpected D1 batch operation");
    },
  };
}

test("rejects malformed JSON and unsupported countries before accessing D1", async () => {
  const malformed = await handleAnalyzeContentRequest(
    new Request("https://contentchecker.example/api/analyze-content", { method: "POST", body: "{" }),
    null,
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Invalid request." });

  const unsupported = await handleAnalyzeContentRequest(
    makeRequest({ body: { text: "hello", countryCode: "XX" } }),
    null,
  );
  assert.equal(unsupported.status, 400);
  assert.deepEqual(await unsupported.json(), { error: "Invalid request." });
});

test("returns JSON 405 for unsupported methods without accessing D1", async () => {
  const response = await handleAnalyzeContentRequest(makeRequest({ method: "GET" }), null);
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Method not allowed." });
});

test("scans using D1 patterns and preserves the analyzer response shape", async () => {
  const response = await handleAnalyzeContentRequest(
    makeRequest({
      body: { text: "bad BAD safe", countryCode: "US" },
      headers: { "cf-connecting-ip": "203.0.113.7", "x-client-id": "client-identifier-123456" },
    }),
    makeFakeD1(["bad"]),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    found: [{ word: "bad", count: 2 }],
    matchCount: 1,
    highlightedHTML: '<mark class="highlight">bad</mark> <mark class="highlight">BAD</mark> safe',
  });
});

test("returns the allowed origin headers for the existing checker origin", async () => {
  const response = await handleAnalyzeContentRequest(
    new Request("https://contentchecker-d1-migrated.example/api/analyze-content", {
      method: "OPTIONS",
      headers: { origin: "https://brainly-ban-checker.vercel.app" },
    }),
    null,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://brainly-ban-checker.vercel.app");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
});
