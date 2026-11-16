# Content Checker

An independent Next.js app for comparing draft text with selected regional reference lists. It is not affiliated with or endorsed by Brainly, and its results are informational rather than moderation decisions.

## How it works

The browser posts entered text to the same-origin `/api/analyze-content` route. The route runs in the Cloudflare Worker, reads the private `ban_words` table from its D1 binding, evaluates the regex patterns, and returns matched text, occurrence counts, and an escaped highlighted preview. The complete word list is never sent to the browser or stored in this repository.

Matching is case-insensitive substring matching. A rule can match inside a longer word, so results can include false positives. Submitted text is analyzed in memory and is not written to an application content table; avoid entering passwords or other sensitive personal information.

## Supported reference lists

- United States (`US`)
- Brazil (`BR`)
- Romania (`RO`)
- Philippines (`PH`)

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. D1 uses Wrangler's local simulation by default; local schema setup is a separate migration action and should only be run when authorized.

## Cloudflare configuration

This clone uses `@opennextjs/cloudflare` and Wrangler to deploy the app as the `contentchecker` Worker at `https://contentchecker.seft.workers.dev`. The Wrangler D1 binding is `DB` and points to the separate D1 database `contentchecker-d1-migrated` (`743f8aab-6802-4a4c-bf29-fcb29f2d8dd0`). The previous `contentchecker-d1-migrated` Worker deployment remains available as a fallback.

The D1 schema is in `migrations/0001_init.sql`. The repository contains no exported banned-word data. Keep any data-import SQL outside the repository and do not place the private word list under `public/`, in a client component, or in a `NEXT_PUBLIC_` variable.

The schema is in `migrations/0001_init.sql`; the owner-approved SQL data import is handled separately and remains outside Git. Remote database changes and deployments require explicit owner approval. The `contentchecker` Worker is configured to build and deploy only from the `cloudflare-migration` branch; do not deploy this project from `main`.

Workers Builds for the `contentchecker` Worker use the `e1n7/contentchecker` repository and watch `cloudflare-migration` only. The Supabase project is not part of this migration.

## Checks

```bash
npm test
npm run cf:build
```

The original `supabase/migrations/` directory is retained as historical source material and is not used or applied by the Cloudflare deployment.
