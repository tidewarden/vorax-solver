# Live-data collector

The Solver shares the boards it reads (see the main README). This Worker stores them so the simulator's
odds can be measured against the live game. It's a Cloudflare Worker with a D1 database, on Cloudflare's
free plan: nothing is billed, and if a daily limit is hit, uploads simply fail until midnight UTC.

- `POST /v1/icons`, `POST /v1/cards`: an instrument icon a player named, a card the Solver didn't recognise. Kept until
  2026-10-30; now answered as stored and dropped, so the Solver doesn't send them again (the reader knows every card).
- `POST /v1/training/ask`, `POST /v1/training`: a screenshot of the game window for a card the reader has fewer than 3
  pictures of, or read slowly (`src/training.ts`): committed to the `training-data` branch of the private tidewarden/vorax-training-data and shown in one
  `Training Data: <card>` issue per card, at most 3 screenshots a card and 10 new cards a day. The app asks first, so
  a card no longer wanted is never sent.
- `POST /v1/snapshots`: 1 to 10 boards. Each is rebuilt from the fields the collector knows (card,
  instrument and protocol names from `src/names.json`, numbers within the engine's bounds); anything
  else is dropped. Retries can't make duplicates.
- `GET /v1/export?after=ID`: up to 5,000 rows after `ID`, for the repo's scheduled workflow. Needs the
  export token.
- `PUT /v1/summary`: the dashboard's numbers, worked out by the hourly workflow from every board
  (`scripts/live/summary.ts`): too much for one request on the free plan. Needs the export token.
- `GET /dashboard`, `GET /v1/stats`: the private analytics page and its numbers, the stored summary with the
  boards and players per day counted here. Needs the dashboard password (`DASHBOARD_TOKEN`).

No accounts and no addresses: each address may upload 20 times a minute (up to 10 boards each), counted
against a salted hash that changes daily. An upload is one row in `batches`, and each player one row a day in
`players`, so the free plan's 100,000 row writes a day go a long way. Only the site (`https://tidewarden.github.io`, and `https://voraxlab.pages.dev`) may post from a browser.

## Setup (once, about 10 minutes)

From this folder, with Node 20+:

```
npx wrangler login
npx wrangler d1 create vorax-live            # put the printed database_id in wrangler.jsonc
npx wrangler d1 execute vorax-live --remote --file schema.sql
npx wrangler deploy                          # prints the Worker's URL
npx wrangler secret put EXPORT_TOKEN         # a long random string
npx wrangler secret put IP_SALT              # another long random string
```

Then, from the repo root:

```
gh secret set LIVE_DATA_TOKEN                # the same value as EXPORT_TOKEN
gh variable set LIVE_DATA_URL --body https://vorax-live.<your-subdomain>.workers.dev
```

and put the same URL in `src/solver/share/endpoint.ts` (`ENDPOINT`). The secrets live only in Cloudflare
and in GitHub's encrypted settings, never in the repo.

After labelling new protocol names, regenerate the accepted names with `npx vite-node scripts/live/names.ts`
and redeploy.
