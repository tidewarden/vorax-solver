// Pulls new shared boards from the collector into data/live/raw/<date>.jsonl. Usage (the live-data and dashboard
// workflows set these):
//   LIVE_DATA_URL=https://… LIVE_DATA_TOKEN=… npx vite-node scripts/live/pull.ts
// The odds (data/live/rates.json) aren't worked out from the boards since Oct 24: they had settled, and the boards
// are stored without their cards since (worker/src/validate.ts lean). scripts/live/rates.ts still works on old ones.
import { pull } from './collect'

const url = process.env.LIVE_DATA_URL
const token = process.env.LIVE_DATA_TOKEN
if (!url || !token) {
  console.log('LIVE_DATA_URL / LIVE_DATA_TOKEN not set: no collector yet, nothing to pull.')
  process.exit(0)
}
const added = await pull(url, token)
console.log(`${added} new boards`)
