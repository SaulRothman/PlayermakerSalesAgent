# DevRev webhook → `/api/agent/events`

This org is async-only. `POST /api/agent` calls `ai-agents.events.execute-async` and **waits**. The reply is an `AI_AGENT_RESPONSE` to `POST /api/agent/events`. There is no sync path.

`AgentTurnResponse` is unchanged. `devrevConfigured()` is true when `DEVREV_PAT`, `DEVREV_AGENT_ID`, `DEVREV_AGENT_ENDPOINT`, and `DEVREV_WEBHOOK_ID` are all set. Otherwise the scripted mock stays on.

`execute-async` body is exact:

```json
{
  "agent": "<DEVREV_AGENT_ID>",
  "event": { "input_message": { "message": "<user text>" } },
  "session_object": "<page session_id — plain text, not a DON>",
  "webhook_target": { "webhook": "<DEVREV_WEBHOOK_ID>" }
}
```

`session_object` is the page `session_id` (plain text for agent memory). Not a conversation DON. `webhook_target.webhook` is required and must be a webhook DON subscribed to **AI_AGENT_RESPONSE**, pointing at `https://<public-web-host>/api/agent/events`.

Local proof (no real PAT / agent / webhook id):

```bash
cd web
npm run dev          # already-running :3000 is fine
npm run simulate-webhook
```

Dev-only page hook: `/help-me-decide?async_harness=1` sends `source: "async-harness"` so the page waits on the same inbox. Transcript shows **Thinking…** until the webhook (or timeout).

---

## Env keys I need from you

Set these in `web/.env.local` (never `NEXT_PUBLIC_*`, never commit real values).

| Key | Required for live | What it is |
| --- | --- | --- |
| `DEVREV_PAT` | yes (already in `.env.local`) | Personal access token. Server-only. |
| `DEVREV_AGENT_ID` | yes (set) | `don:core:dvrv-us-1:devo/111SOeMpZI:ai_agent/73` |
| `DEVREV_AGENT_ENDPOINT` | yes (already set) | `https://api.devrev.ai/internal/ai-agents.events.execute-async` |
| `DEVREV_WEBHOOK_ID` | yes | Webhook DON subscribed to `AI_AGENT_RESPONSE`. Sent as `webhook_target.webhook`. Also used to verify inbound callbacks. |
| `DEVREV_REPLY_TIMEOUT_MS` | no | Defaults to `60000`. `/api/agent` returns a fallback **200** (does not hang). |

Still needed from you (PAT, endpoint, and agent id are stored):

1. `DEVREV_WEBHOOK_ID` — webhook DON subscribed to `AI_AGENT_RESPONSE`
2. That webhook pointing at `https://<public-web-host>/api/agent/events`
3. Public HTTPS URL of **this web app** (DevRev cannot reach localhost)

Webhook URL: `https://<your-public-web-host>/api/agent/events` (web app, not the catalog API).

---

## What `/api/agent/events` accepts

The handler is tolerant. It unwraps, in order:

1. `payload.ai_agent_response` (official DevRev envelope)
2. `payload` (if that object is the response)
3. `ai_agent_response`
4. `event`
5. the root body (flat / mapped)

### Handshake

```http
POST /api/agent/events
{"challenge":"<token>"}
```

```http
GET /api/agent/events?challenge=<token>
```

Official DevRev verify (required or the webhook stays unverified):

```http
POST /api/agent/events
{
  "type": "verify",
  "webhook_id": "don:integration:…:webhook/…",
  "verify": { "challenge": "<token>" }
}
```

Must respond `200 { "challenge": "<token>" }` — exact echo. Root `{ "challenge" }` and `GET ?challenge=` also work.

If `DEVREV_WEBHOOK_ID` is set and the callback includes `webhook_id` / `webhook.id` / `x-devrev-webhook-id`, a mismatch is **401**. Challenge and events with no webhook id still pass.

### Session match (required)

One of these must be a non-empty string or the handler returns **400**:

- `client_metadata.conversation_id`
- `client_metadata.session_id`
- `session_object`
- `session_id`
- `session.id`

execute-async sends `session_object` as the page `session_id` (plain text). Match the webhook on `session_object` / `session_id` / `client_metadata.conversation_id`.

### Event kinds

| Kind | How we detect it | What we do |
| --- | --- | --- |
| `progress` | `agent_response: "progress"` or a `progress` object | Apply `progress.skill_executed.output` to the session panel / lead. Do **not** resolve the waiter. |
| `message` | `agent_response: "message"`, or `messages` / `message` / `panel` / `lead_form` | Resolve `POST /api/agent` with an `AgentTurnResponse`. |
| `error` | `agent_response: "error"` or `error` | Resolve with a fallback agent bubble. |
| duplicate | same `event_id` / `id` (don:) / derived key | `200 { ok, duplicate: true }` — ignored. |
| late | message/error after that turn already settled | `200 { ok, late: true }` — ignored. |
| unknown / no session | — | **400**. |

Progress before message is the expected DevRev order. Message-then-skill is tolerated: we wait 150ms so a trailing `skill_executed` can attach to the panel. A webhook that arrives before `POST /api/agent` is queued and delivered when the waiter registers.

### Official-shaped example (fit match + chips)

```json
{
  "type": "ai_agent_response",
  "session_id": "PAGE_SESSION_ID",
  "payload": {
    "ai_agent_response": {
      "event_id": "unique-per-delivery",
      "agent_response": "progress",
      "session_object": "PAGE_SESSION_ID",
      "client_metadata": { "conversation_id": "PAGE_SESSION_ID" },
      "progress": {
        "progress_state": "skill_executed",
        "skill_executed": {
          "skill_name": "fit_match",
          "output": {
            "outcome": "match",
            "best_fit_product_id": "playermaker-2.0",
            "why": "from the catalog skill — never invent",
            "product": {
              "product_id": "playermaker-2.0",
              "name": "Playermaker 2.0",
              "price": "$199",
              "image_url": null,
              "role": "primary",
              "what_it_does": "from the catalog"
            }
          }
        }
      }
    }
  }
}
```

Then the resolving message (same `session_object` / `conversation_id`):

```json
{
  "payload": {
    "ai_agent_response": {
      "event_id": "unique-message-id",
      "agent_response": "message",
      "session_object": "PAGE_SESSION_ID",
      "client_metadata": { "conversation_id": "PAGE_SESSION_ID" },
      "messages": [{ "id": "m1", "role": "agent", "text": "Store-manager copy. No invented prices." }],
      "chips": [
        { "id": "why", "label": "Why this one?" },
        { "id": "compare", "label": "Compare kits" }
      ],
      "lead_form": {
        "show": true,
        "title": "Want a note when you are ready?",
        "body": "Name and email only.",
        "submit_label": "Send",
        "fields": [
          { "id": "parent_name", "label": "Your name", "type": "text", "required": true },
          { "id": "email", "label": "Email", "type": "email", "required": true }
        ]
      }
    }
  }
}
```

If your webhook cannot nest under `payload.ai_agent_response`, POST the inner object at the root. Same fields.

### Flat mapped example (if you transform in DevRev)

```json
{
  "session_id": "PAGE_SESSION_ID",
  "messages": [{ "role": "agent", "text": "Thanks — we logged that." }],
  "chips": [],
  "lead": {
    "lead_id": "don:identity:dvrv-us/xxx",
    "pipeline": { "destination": "devrev" }
  }
}
```

### Message field aliases

- text: `messages[]` (`text` / `message` / `body`) or a string `message`
- chips: `chips` / `suggested_replies` / `options` (`label` / `display_name` / `text`)
- panel: `panel`, or skill `output` with `outcome` + `products` / `product` + `best_fit_product_id`

### Timeout

If no resolving message arrives within `DEVREV_REPLY_TIMEOUT_MS`, `/api/agent` still returns **200**:

```json
{
  "session_id": "…",
  "messages": [{ "role": "agent", "text": "I didn’t hear back from the store manager in time. Try that again — I won’t guess a kit." }],
  "chips": [],
  "panel": { "outcome": "none", "emphasized_product_id": null, "products": [], "why": null },
  "lead_form": null,
  "lead": null,
  "signals": {},
  "done": false,
  "source": "devrev"
}
```

The page clears **Thinking…** on that 200. It does not hang.

---

## Thinking state (page)

`DecideExperience` sets `pending` for the whole `fetch("/api/agent")`. While pending the transcript renders `Thinking…` (`data-thinking="true"`) and disables chips / composer / lead submit. `pending` clears in `finally` on arrival or 502.

---

## In-memory waiters

Inbox + waiters live in the **Next.js Node process**. Same process must receive both `/api/agent` and `/api/agent/events` (local `next dev` / a single Node `next start`). Multi-instance serverless will not share the inbox — pin this route to one instance when you go live.
