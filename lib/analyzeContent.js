import { analyzeText } from "./analyzeText.js";

const ALLOWED_COUNTRIES = new Set(["PH", "US", "BR", "RO"]);
const WORD_CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30;
const IP_RATE_LIMIT_MAX_REQUESTS = 120;
const MAX_CONCURRENT_REQUESTS = 20;
const CONCURRENCY_LEASE_SECONDS = 30;
const MAX_WORDS_PER_PAGE = 1000;
const MAX_TEXT_LENGTH = 20000;
const WORD_CACHE = new Map();
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://brainly-ban-checker.vercel.app",
  "https://3001-ieoh7kkmg0yp1albdiqkc-5e80eff0.sg2.manus.computer",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

export async function handleAnalyzeContentRequest(request, db, env = {}) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: getCorsHeaders(request, env) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, env, { error: "Method not allowed." }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid request." }, 400);
  }

  const { text, countryCode } = payload ?? {};
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH || !ALLOWED_COUNTRIES.has(countryCode)) {
    return jsonResponse(request, env, { error: "Invalid request." }, 400);
  }

  try {
    const slotId = await acquireAnalyzeContentSlot(db);
    if (!slotId) {
      return jsonResponse(
        request,
        env,
        { error: "The analyzer is busy right now. Please wait a moment and try again." },
        503,
        { "Retry-After": "2" },
      );
    }

    try {
      const rateLimit = await consumeRateLimit(request, db);
      if (!rateLimit.available) {
        return jsonResponse(
          request,
          env,
          { error: "The analyzer is temporarily unavailable. Please try again shortly." },
          503,
          { "Retry-After": String(rateLimit.retryAfterSeconds) },
        );
      }
      if (!rateLimit.allowed) {
        return jsonResponse(
          request,
          env,
          { error: "Too many scans. Please wait a moment and try again." },
          429,
          { "Retry-After": String(rateLimit.retryAfterSeconds) },
        );
      }

      const result = analyzeText(text, await getBannedWords(db, countryCode));
      return jsonResponse(request, env, {
        found: result.found,
        matchCount: result.found.length,
        highlightedHTML: result.highlightedHTML,
      });
    } finally {
      await db.prepare("DELETE FROM analyze_content_slots WHERE slot_id = ?").bind(slotId).run();
    }
  } catch (error) {
    console.error("Content analysis failed", error);
    return jsonResponse(request, env, { error: "Unable to analyze content." }, 500);
  }
}

async function getBannedWords(db, countryCode) {
  const cached = WORD_CACHE.get(countryCode);
  if (cached && cached.expiresAt > Date.now()) return cached.words;

  const words = [];
  for (let offset = 0; ; offset += MAX_WORDS_PER_PAGE) {
    const { results = [] } = await db
      .prepare("SELECT word FROM ban_words WHERE country_code = ? AND enabled = 1 ORDER BY id LIMIT ? OFFSET ?")
      .bind(countryCode, MAX_WORDS_PER_PAGE, offset)
      .all();
    words.push(...results.map((row) => row.word));
    if (results.length < MAX_WORDS_PER_PAGE) break;
  }

  WORD_CACHE.set(countryCode, { words, expiresAt: Date.now() + WORD_CACHE_TTL_MS });
  return words;
}

async function acquireAnalyzeContentSlot(db) {
  const slotId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare("DELETE FROM analyze_content_slots WHERE julianday(expires_at) <= julianday('now')"),
    db.prepare(`
      INSERT INTO analyze_content_slots (slot_id, acquired_at, expires_at)
      SELECT ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' seconds')
      WHERE (SELECT COUNT(*) FROM analyze_content_slots WHERE julianday(expires_at) > julianday('now')) < ?
      RETURNING slot_id
    `).bind(slotId, CONCURRENCY_LEASE_SECONDS, MAX_CONCURRENT_REQUESTS),
  ]);
  return results[1]?.results?.[0]?.slot_id ?? null;
}

async function hashRateLimitIdentity(identity) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`analyze-content:${identity}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getRateLimitIdentity(request) {
  return request.headers.get("cf-connecting-ip")?.trim()
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "unknown";
}

async function consumeRateLimit(request, db) {
  try {
    const ipBucket = await consumeBucket(
      db,
      `analyze:ip:${await hashRateLimitIdentity(getRateLimitIdentity(request))}`,
      IP_RATE_LIMIT_MAX_REQUESTS,
    );
    const clientId = request.headers.get("x-client-id")?.trim();
    const clientBucket = clientId && /^[A-Za-z0-9-]{16,100}$/.test(clientId)
      ? await consumeBucket(db, `analyze:client:${await hashRateLimitIdentity(clientId)}`, RATE_LIMIT_MAX_REQUESTS)
      : { allowed: true, retryAfterSeconds: 0 };

    return {
      available: true,
      allowed: ipBucket.allowed && clientBucket.allowed,
      retryAfterSeconds: Math.max(ipBucket.retryAfterSeconds, clientBucket.retryAfterSeconds),
    };
  } catch (error) {
    console.error("Rate limit check failed", error);
    return { available: false, allowed: false, retryAfterSeconds: 5 };
  }
}

async function consumeBucket(db, bucketKey, limit) {
  const results = await db.batch([
    db.prepare("DELETE FROM rate_limit_buckets WHERE julianday(updated_at) < julianday('now', '-24 hours')"),
    db.prepare(`
      INSERT INTO rate_limit_buckets (bucket_key, window_started, request_count, updated_at)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(bucket_key) DO UPDATE SET
        window_started = CASE
          WHEN julianday(rate_limit_buckets.window_started) <= julianday('now', '-' || ? || ' seconds')
            THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ELSE rate_limit_buckets.window_started
        END,
        request_count = CASE
          WHEN julianday(rate_limit_buckets.window_started) <= julianday('now', '-' || ? || ' seconds')
            THEN 1
          ELSE MIN(rate_limit_buckets.request_count + 1, ? + 1)
        END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      RETURNING window_started, request_count
    `).bind(bucketKey, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_WINDOW_SECONDS, limit),
  ]);
  const row = results[1]?.results?.[0];
  if (!row) throw new Error("Rate limit check returned no data");

  const allowed = Number(row.request_count) <= limit;
  const windowEnd = Date.parse(row.window_started) + RATE_LIMIT_WINDOW_SECONDS * 1000;
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000)),
  };
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const configured = typeof env.ALLOWED_ORIGINS === "string"
    ? env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  const allowedOrigins = new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
  allowedOrigins.add("https://brainly-ban-checker.vercel.app");

  const headers = {
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, x-client-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function jsonResponse(request, env, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, env),
      ...extraHeaders,
      "Content-Type": "application/json",
    },
  });
}
