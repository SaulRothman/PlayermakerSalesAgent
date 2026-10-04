#!/usr/bin/env node
/**
 * Local DevRev webhook harness. No PAT / agent id required.
 *
 *   1. POST /api/agent  source=async-harness  → waiter (page "Thinking…")
 *   2. POST /api/agent/events                 → inbox
 *   3. /api/agent resolves with AgentTurnResponse
 *
 * Requires `npm run dev` on :3000.
 */
const BASE = process.env.WEB_BASE || "http://localhost:3000";
const FALLBACK =
  "I didn’t hear back from the store manager in time. Try that again — I won’t guess a kit.";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ok(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.error(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function envelope(sessionId, eventId, inner) {
  return {
    type: "ai_agent_response",
    session_id: sessionId,
    payload: {
      ai_agent_response: {
        event_id: eventId,
        session_object: sessionId,
        client_metadata: { conversation_id: sessionId },
        ...inner,
      },
    },
  };
}

const MATCH_OUTPUT = {
  outcome: "match",
  best_fit_product_id: "playermaker-2.0",
  why: "Age and club play line up with Playermaker 2.0.",
  product: {
    product_id: "playermaker-2.0",
    name: "Playermaker 2.0",
    price: "199.00",
    currency: "USD",
    url: "https://www.playermaker.com/products/playermaker",
    image_url: null,
    role: "core_kit",
    what_it_does: "Smart football tracker for the boot.",
  },
};

const LEAD_FORM = {
  show: true,
  title: "Want a note when you are ready?",
  body: "Name and email only.",
  submit_label: "Send",
  fields: [
    { id: "parent_name", label: "Your name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true },
  ],
};

function startWait(sessionId, timeoutMs = 8000, extra = {}) {
  return post("/api/agent", {
    session_id: sessionId,
    message: "",
    input_type: "start",
    source: "async-harness",
    timeout_ms: timeoutMs,
    signals: { age: 12, buyer_type: "parent" },
    ...extra,
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/help-me-decide`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Next.js not reachable at ${BASE} — start it with npm run dev`);
}

async function testChallenge() {
  const official = await post("/api/agent/events", {
    id: "don:integration:dvrv-us-1:devo/example:webhook/123:event/abcdef",
    webhook_id: "don:integration:dvrv-us-1:devo/example:webhook/123",
    timestamp: "2022-08-01T12:00:00.123456789Z",
    type: "verify",
    verify: { challenge: "DlrVaK7zRyZWwbJhj5dZHDlrVaK7Jhj5dZZjH" },
  });
  assert(
    official.status === 200 && official.data.challenge === "DlrVaK7zRyZWwbJhj5dZHDlrVaK7Jhj5dZZjH",
    `official verify ${JSON.stringify(official)}`,
  );
  const postCh = await post("/api/agent/events", { challenge: "tok-post" });
  assert(postCh.status === 200 && postCh.data.challenge === "tok-post", `POST challenge ${JSON.stringify(postCh)}`);
  const getCh = await get("/api/agent/events?challenge=tok-get");
  assert(getCh.status === 200 && getCh.data.challenge === "tok-get", `GET challenge ${JSON.stringify(getCh)}`);
  ok("webhook verify (official type=verify + challenge echo)");
}

async function testInvalid() {
  const empty = await post("/api/agent/events", {});
  assert(empty.status === 400 && /session_id/i.test(empty.data.error || ""), `empty ${JSON.stringify(empty)}`);
  const junk = await post("/api/agent/events", { session_id: "x", foo: 1 });
  assert(junk.status === 400 && /unrecognized/i.test(junk.data.error || ""), `junk ${JSON.stringify(junk)}`);
  ok("invalid payload → 400");
}

async function testMatchRoundTrip() {
  const sid = `harness-match-${Date.now()}`;
  const started = Date.now();
  const waiting = startWait(sid);
  await sleep(80);
  const skill = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-skill`, {
      agent_response: "progress",
      progress: {
        progress_state: "skill_executed",
        skill_executed: { skill_name: "fit_match", output: MATCH_OUTPUT },
      },
    }),
  );
  assert(skill.status === 200 && skill.data.ok, `skill ${JSON.stringify(skill)}`);
  const msg = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-msg`, {
      agent_response: "message",
      messages: [{ id: "m1", role: "agent", text: "Playermaker 2.0 is the fit from the catalog." }],
      chips: [
        { id: "why", label: "Why this one?" },
        { id: "compare", label: "Compare kits" },
      ],
      lead_form: LEAD_FORM,
    }),
  );
  assert(msg.status === 200 && msg.data.ok && !msg.data.late, `msg ${JSON.stringify(msg)}`);
  const { status, data } = await waiting;
  const waited = Date.now() - started;
  assert(status === 200, `wait status ${status} ${JSON.stringify(data)}`);
  assert(data.source === "devrev", `source ${data.source}`);
  assert(data.session_id === sid, "session_id mismatch");
  assert(data.messages?.[0]?.text.includes("Playermaker 2.0"), `messages ${JSON.stringify(data.messages)}`);
  assert(data.chips?.length === 2 && data.chips[0].id === "why", `chips ${JSON.stringify(data.chips)}`);
  assert(data.panel?.outcome === "match", `panel ${JSON.stringify(data.panel)}`);
  assert(data.panel.emphasized_product_id === "playermaker-2.0", "emphasized");
  assert(data.panel.products?.[0]?.price === "$199", "price must come from skill output");
  assert(data.lead_form?.show === true, "lead_form");
  assert(data.signals?.age === 12, "signals echoed");
  assert(waited >= 80, "waiter actually blocked until webhook");
  ok(`POST-pending → webhook match+chips+panel (${waited}ms — page shows Thinking… for this)`);
  return { sid, data };
}

async function testLeadAck() {
  const sid = `harness-lead-${Date.now()}`;
  const waiting = startWait(sid, 8000, { input_type: "lead", profile: { parent_name: "Sam", email: "sam@example.com" } });
  await sleep(60);
  const ev = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-lead`, {
      agent_response: "message",
      messages: [{ role: "agent", text: "Thanks — we logged that." }],
      lead: { lead_id: "lead-harness-1", pipeline: { destination: "local" } },
    }),
  );
  assert(ev.status === 200 && ev.data.ok, `lead event ${JSON.stringify(ev)}`);
  const { status, data } = await waiting;
  assert(status === 200, `lead wait ${status}`);
  assert(data.lead?.captured === true, `lead ${JSON.stringify(data.lead)}`);
  assert(data.lead.destination === "local" && data.lead.lead_id === "lead-harness-1", "lead fields");
  assert(/logged/i.test(data.messages?.[0]?.text || ""), `lead message ${JSON.stringify(data.messages)}`);
  ok("lead ack webhook → captured lead on waiting POST");
}

async function testDuplicateAndLate(priorSid) {
  const sid = priorSid;
  const dup = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-msg`, {
      agent_response: "message",
      messages: [{ role: "agent", text: "duplicate should be ignored" }],
    }),
  );
  assert(dup.status === 200 && dup.data.duplicate === true, `dup ${JSON.stringify(dup)}`);
  const late = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-late`, {
      agent_response: "message",
      messages: [{ role: "agent", text: "late should be ignored" }],
    }),
  );
  assert(late.status === 200 && late.data.late === true, `late ${JSON.stringify(late)}`);
  ok("duplicate + late callbacks → 200 ignored");
}

async function testOutOfOrder() {
  const sid = `harness-ooo-${Date.now()}`;
  const waiting = startWait(sid);
  await sleep(60);
  const msg = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-msg`, {
      agent_response: "message",
      messages: [{ role: "agent", text: "Here is the kit from the catalog." }],
      chips: [{ id: "why", label: "Why this one?" }],
    }),
  );
  assert(msg.status === 200 && msg.data.ok, `ooo msg ${JSON.stringify(msg)}`);
  const skill = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-skill`, {
      agent_response: "progress",
      progress: {
        progress_state: "skill_executed",
        skill_executed: { skill_name: "fit_match", output: MATCH_OUTPUT },
      },
    }),
  );
  assert(skill.status === 200 && skill.data.ok, `ooo skill ${JSON.stringify(skill)}`);
  const { status, data } = await waiting;
  assert(status === 200, `ooo wait ${status}`);
  assert(data.panel?.outcome === "match", `ooo panel ${JSON.stringify(data.panel)}`);
  assert(data.chips?.[0]?.id === "why", "ooo chips");
  ok("out-of-order message then skill_executed still attaches panel");
}

async function testWrappedHttpSkillOutput() {
  const sid = `harness-httpwrap-${Date.now()}`;
  const waiting = startWait(sid);
  await sleep(40);
  const skill = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-skill`, {
      progress: {
        progress_state: "skill_executed",
        skill_executed: {
          skill_name: "fit_match",
          output: { status_code: 200, body: JSON.stringify(MATCH_OUTPUT) },
        },
      },
    }),
  );
  assert(skill.status === 200 && skill.data.ok, `wrap skill ${JSON.stringify(skill)}`);
  const msg = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-msg`, {
      agent_response: "message",
      messages: [{ role: "agent", text: "CITYPLAY from the catalog." }],
    }),
  );
  assert(msg.status === 200, `wrap msg ${JSON.stringify(msg)}`);
  const { status, data } = await waiting;
  assert(status === 200, `wrap wait ${status}`);
  assert(data.panel?.outcome === "match", `wrap panel ${JSON.stringify(data.panel)}`);
  assert(data.panel.products?.[0]?.product_id === "playermaker-2.0", "wrap product_id");
  assert(data.panel.products?.[0]?.url?.includes("playermaker.com"), "wrap buy url");
  ok("HTTP-wrapped skill output still fills the options panel");
}

async function testEarlyWebhook() {
  const sid = `harness-early-${Date.now()}`;
  const ev = await post(
    "/api/agent/events",
    envelope(sid, `${sid}-early`, {
      agent_response: "message",
      messages: [{ role: "agent", text: "Webhook beat the waiter." }],
      chips: [{ id: "next", label: "Next" }],
    }),
  );
  assert(ev.status === 200 && ev.data.ok, `early ev ${JSON.stringify(ev)}`);
  const { status, data } = await startWait(sid);
  assert(status === 200, `early wait ${status}`);
  assert(data.messages?.[0]?.text.includes("Webhook beat"), `early ${JSON.stringify(data.messages)}`);
  assert(data.chips?.[0]?.id === "next", "early chips");
  ok("early webhook queued, then waiter resolves immediately");
}

async function testTimeout() {
  const sid = `harness-timeout-${Date.now()}`;
  const started = Date.now();
  const { status, data } = await startWait(sid, 400);
  const waited = Date.now() - started;
  assert(status === 200, `timeout status ${status} ${JSON.stringify(data)}`);
  assert(data.messages?.[0]?.text === FALLBACK, `timeout text ${JSON.stringify(data.messages)}`);
  assert(data.panel?.outcome === "none", "timeout panel empty");
  assert(data.source === "devrev", "timeout source");
  assert(waited >= 350, `timeout too fast (${waited}ms)`);
  ok(`timeout fallback 200 in ${waited}ms — Thinking… clears, no hang`);
}

async function testThinkingCopy() {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const page = join(dirname(fileURLToPath(import.meta.url)), "../src/components/DecideExperience.tsx");
  const src = readFileSync(page, "utf8");
  assert(src.includes("Thinking…"), "DecideExperience missing Thinking… copy");
  assert(src.includes('data-thinking="true"'), "missing data-thinking");
  assert(/setPending\(true\)/.test(src) && /setPending\(false\)/.test(src), "pending not cleared");
  const res = await fetch(`${BASE}/help-me-decide`);
  assert(res.ok, `page ${res.status}`);
  ok("page Thinking… bound to pending; clears on reply or timeout");
}

async function main() {
  console.log(`\nWebhook harness → ${BASE}\n`);
  await waitForServer();

  const tests = [
    testChallenge,
    testInvalid,
    async () => {
      const { sid } = await testMatchRoundTrip();
      await testDuplicateAndLate(sid);
    },
    testLeadAck,
    testOutOfOrder,
    testWrappedHttpSkillOutput,
    testEarlyWebhook,
    testTimeout,
    testThinkingCopy,
  ];

  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      fail(t.name || "test", err);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
