# Playermaker thin-client site

Mobile-first storefront in `/web`. Product copy and prices come from the catalog API **on the server**. The browser never calls `localhost:3001` and never runs fit logic.

```bash
# catalog API must already be on :3001
cd web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000

Hosted (Render): see repo-root `render.yaml`. Production `npm start` binds `0.0.0.0:$PORT`.

Routes: `/`, `/products`, `/products/[id]`, `/how-it-works`, `/faq`, `/help-me-decide`.

## Help me decide

`/help-me-decide` is a thin client. It does not ask the 3 questions, run the honesty check, or match kits. Every chip tap or typed message goes to `POST /api/agent` on this Next server; the page only renders the reply (messages, chips, panel).

The proxy never runs in the browser. It reads `DEVREV_PAT` from the server env. If `DEVREV_PAT`, `DEVREV_AGENT_ID`, `DEVREV_AGENT_ENDPOINT`, and `DEVREV_WEBHOOK_ID` are all set, it forwards the turn to DevRev (`web/src/server/devrev-agent.ts`). Otherwise it uses the scripted mock (`web/src/server/mock-agent.ts`). Each turn carries catalog `BuyerSignals` (age, wants_man_city_content, already_owns_kit, buyer_type, …) — not training_frequency/goal. Lead submits send `session_id` + `parent_name` + `email`.

Configure real values in `web/.env.local` (see `web/.env.example`). Org slug defaults to `playermaker`.

This org is **async-only**. `execute-async` is `{ agent, event.input_message.message, session_object, webhook_target: { webhook } }`. `session_object` is the page session_id (plain text). Reply arrives as `AI_AGENT_RESPONSE` on `POST /api/agent/events`. See `AGENT_SETUP.md`.

Local proof (no PAT / agent id required):

```bash
# Next must already be on :3000 (npm run dev)
npm run simulate-webhook
```

`?async_harness=1` on `/help-me-decide` (dev only) makes the page wait on the webhook the same way live will. The transcript shows **Thinking…** between the execute POST and the webhook (or timeout fallback).

After a recommendation **or an honest-no**, the agent offers a profile + email form. Submit is another turn (`input_type: "lead"`). The mock calls catalog `POST /v1/leads` (the same contract skill 223 will use). With `DEVREV_PAT` on the API that writes a DevRev account + contact; otherwise it stores `data/playermaker/leads.json` (gitignored).

Phase 6 prerequisite: DevRev cloud cannot reach `localhost:3001`. Deploy or tunnel the catalog API to a public HTTPS URL before wiring skills 220–223.
