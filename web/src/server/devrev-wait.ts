/**
 * In-memory waiters + inbox for async DevRev webhooks.
 * One Next server process; harness and live execute-async share this.
 */
import type {
  AgentChip,
  AgentTurnResponse,
  BuyerSignals,
  LeadFormState,
  LeadResult,
  PanelState,
} from "@/lib/agent-protocol";
import { cleanSignals } from "@/lib/signals";

import {
  asChips,
  asMessages,
  leadFromSkillOutput,
  panelFromSkillOutput,
  unwrapFitPayload,
} from "@/server/devrev-parse";

export const DEFAULT_REPLY_TIMEOUT_MS = 25_000;
export const FALLBACK_TEXT =
  "I didn’t hear back from the store manager in time. Try that again — I won’t guess a kit.";

type Inbox = {
  signals: BuyerSignals;
  panel: PanelState;
  chips: AgentChip[];
  lead_form: LeadFormState | null;
  lead: LeadResult | null;
  queued?: AgentTurnResponse;
  seen: Set<string>;
  waiter?: {
    resolve: (value: AgentTurnResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  settled?: AgentTurnResponse;
};

const inboxes = new Map<string, Inbox>();
/** page session_id → conversation/session DON, and DON → page session_id */
const pageToDon = new Map<string, string>();
const donToPage = new Map<string, string>();

/** Let a trailing skill_executed attach before we settle a message-only event. */
const SETTLE_GRACE_MS = 800;

function emptyPanel(): PanelState {
  return { outcome: "none", emphasized_product_id: null, products: [], why: null };
}

function inbox(sessionId: string): Inbox {
  let box = inboxes.get(sessionId);
  if (!box) {
    box = {
      signals: {},
      panel: emptyPanel(),
      chips: [],
      lead_form: null,
      lead: null,
      seen: new Set(),
    };
    inboxes.set(sessionId, box);
  }
  return box;
}

export function rememberSessionAlias(pageSessionId: string, sessionObject: string): void {
  const page = pageSessionId.trim();
  const don = sessionObject.trim();
  if (!page || !don) return;
  pageToDon.set(page, don);
  donToPage.set(don, page);
}

export function aliasedConversationDon(pageSessionId: string): string {
  return pageToDon.get(pageSessionId.trim()) || "";
}

export function sessionObjectFor(pageSessionId: string): string {
  return aliasedConversationDon(pageSessionId) || pageSessionId.trim();
}

export function sessionFromAck(data: Record<string, unknown>): string {
  const session = data.session;
  const candidates = [
    data.session_object,
    typeof session === "string" ? session : undefined,
    typeof session === "object" && session ? (session as { id?: unknown }).id : undefined,
    data.conversation_id,
    data.id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.includes(":conversation/")) return c.trim();
  }
  return "";
}

function resolveSessionKey(raw: string): string {
  return donToPage.get(raw) || raw;
}

export function extractSessionId(body: Record<string, unknown>, inner: Record<string, unknown>): string {
  const meta = (inner.client_metadata || body.client_metadata || {}) as Record<string, unknown>;
  const session = inner.session;
  const candidates = [
    meta.conversation_id,
    meta.session_id,
    inner.session_object,
    inner.session_id,
    body.session_object,
    body.session_id,
    typeof session === "string" ? session : undefined,
    typeof session === "object" && session ? (session as { id?: unknown }).id : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return resolveSessionKey(c.trim());
  }
  return "";
}

function incomingWebhookId(body: Record<string, unknown>, headers?: Headers): string {
  const webhook = body.webhook;
  const headerNames = ["x-devrev-webhook-id", "x-webhook-id", "devrev-webhook-id"];
  const fromHeader = headerNames
    .map((name) => headers?.get(name))
    .find((value) => value && value.trim());
  const candidates = [
    body.webhook_id,
    typeof webhook === "string" ? webhook : undefined,
    typeof webhook === "object" && webhook ? (webhook as { id?: unknown }).id : undefined,
    fromHeader,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/** If DEVREV_WEBHOOK_ID is set and the callback names a webhook, it must match. */
export function verifyInboundWebhook(body: Record<string, unknown>, headers?: Headers): IngestResult | null {
  const expected = process.env.DEVREV_WEBHOOK_ID?.trim();
  if (!expected) return null;
  const got = incomingWebhookId(body, headers);
  if (!got) return null;
  if (got !== expected) {
    return { ok: false, status: 401, error: "webhook id mismatch" };
  }
  return null;
}

export function eventKey(inner: Record<string, unknown>, sessionId: string): string {
  if (typeof inner.event_id === "string" && inner.event_id) return inner.event_id;
  if (typeof inner.id === "string" && inner.id.startsWith("don:")) return inner.id;
  const progress = inner.progress && typeof inner.progress === "object" ? (inner.progress as Record<string, unknown>) : {};
  const skill = (progress.skill_executed || progress.skill_triggered || {}) as Record<string, unknown>;
  return [
    sessionId,
    String(inner.agent_response || inner.type || ""),
    String(progress.progress_state || ""),
    String(skill.skill_name || ""),
    String(inner.message || "").slice(0, 80),
  ].join("|");
}

export function replyTimeoutMs(override?: number): number {
  if (override && override >= 200 && override <= 60_000) return override;
  const env = Number(process.env.DEVREV_REPLY_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= 200) return env;
  return DEFAULT_REPLY_TIMEOUT_MS;
}

function fallbackReply(sessionId: string, signals: BuyerSignals): AgentTurnResponse {
  return {
    session_id: sessionId,
    messages: [{ id: `timeout-${Date.now()}`, role: "agent", text: FALLBACK_TEXT }],
    chips: [],
    panel: emptyPanel(),
    lead_form: null,
    lead: null,
    signals,
    done: false,
    source: "devrev",
  };
}

function mergeReply(box: Inbox, partial: AgentTurnResponse): AgentTurnResponse {
  return {
    ...partial,
    panel: partial.panel.outcome !== "none" ? partial.panel : box.panel,
    chips: partial.chips.length ? partial.chips : box.chips,
    lead_form: partial.lead_form || box.lead_form,
    lead: partial.lead || box.lead,
    signals: Object.keys(partial.signals).length ? partial.signals : box.signals,
  };
}

function settle(sessionId: string, box: Inbox, reply: AgentTurnResponse): void {
  box.settled = reply;
  const waiter = box.waiter;
  box.waiter = undefined;
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(reply);
  }
}

export function waitForWebhookReply(
  sessionId: string,
  signals: BuyerSignals,
  timeoutMs?: number,
): Promise<AgentTurnResponse> {
  const box = inbox(sessionId);
  box.signals = { ...box.signals, ...signals };
  // New turn: drop the previous reply so we don't re-emit it. Keep `queued`
  // (webhook arrived before this waiter registered).
  box.settled = undefined;

  if (box.queued) {
    const reply = mergeReply(box, box.queued);
    box.queued = undefined;
    box.settled = reply;
    return Promise.resolve(reply);
  }

  return new Promise((resolve) => {
    const ms = replyTimeoutMs(timeoutMs);
    const timer = setTimeout(() => {
      const current = inboxes.get(sessionId);
      if (!current || current.waiter?.resolve !== resolve) return;
      settle(sessionId, current, fallbackReply(sessionId, current.signals));
    }, ms);
    box.waiter = { resolve, timer };
  });
}

export function peekSession(sessionId: string): {
  panel: PanelState;
  chips: AgentChip[];
  lead_form: LeadFormState | null;
  lead: LeadResult | null;
} {
  const box = inboxes.get(sessionId);
  if (!box) {
    return { panel: emptyPanel(), chips: [], lead_form: null, lead: null };
  }
  return { panel: box.panel, chips: box.chips, lead_form: box.lead_form, lead: box.lead };
}

export function applySkillOutput(box: Inbox, output: unknown): void {
  const panel = panelFromSkillOutput(output);
  if (panel) box.panel = panel;
  const lead = leadFromSkillOutput(output);
  if (lead) box.lead = lead;
  if (output && typeof output === "object") {
    const rec = output as Record<string, unknown>;
    if (rec.chips) box.chips = asChips(rec.chips);
    if (rec.lead_form) box.lead_form = rec.lead_form as LeadFormState;
    if (rec.signals) box.signals = cleanSignals(rec.signals);
    if (Array.isArray(rec.messages) || typeof rec.message === "string") {
      const msgs = asMessages(rec.messages || rec.message);
      if (msgs.length && box.queued) box.queued.messages = msgs;
    }
  }
}

export type IngestResult = {
  ok: boolean;
  challenge?: string;
  status: number;
  duplicate?: boolean;
  late?: boolean;
  ignored?: boolean;
  error?: string;
};

/** Official DevRev verify: type=verify, challenge in verify.challenge. Echo { challenge }. */
export function extractVerifyChallenge(body: Record<string, unknown>): string {
  const type = String(body.type || body.event_type || "").toLowerCase();
  const verifyObj =
    body.verify && typeof body.verify === "object"
      ? (body.verify as Record<string, unknown>)
      : body.payload && typeof body.payload === "object" && (body.payload as Record<string, unknown>).verify
        ? ((body.payload as Record<string, unknown>).verify as Record<string, unknown>)
        : {};
  const candidates = [verifyObj.challenge, body.challenge, body.token];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return type === "verify" ? "" : "";
}

export function isVerifyEvent(body: Record<string, unknown>): boolean {
  const type = String(body.type || body.event_type || "").toLowerCase();
  if (type === "verify") return true;
  if (body.verify && typeof body.verify === "object") return true;
  return typeof body.challenge === "string";
}

export function ingestDevRevEvent(body: Record<string, unknown>, headers?: Headers): IngestResult {
  if (isVerifyEvent(body)) {
    const challenge = extractVerifyChallenge(body);
    if (!challenge) {
      return { ok: false, status: 400, error: "verify challenge is required" };
    }
    return { ok: true, challenge, status: 200 };
  }

  const denied = verifyInboundWebhook(body, headers);
  if (denied) return denied;

  const inner = unwrap(body);
  const sessionId = extractSessionId(body, inner);
  if (!sessionId) {
    return { ok: false, status: 400, error: "session_id is required (session_object, session_id, or client_metadata.conversation_id)" };
  }

  const kind = classify(inner);
  const skillPayload = extractSkillOutput(inner);
  if (kind === "unknown" && !skillPayload) {
    return { ok: false, status: 400, error: "unrecognized DevRev event (need agent_response, progress, messages, or message)" };
  }

  const box = inbox(sessionId);
  const key = eventKey(inner, sessionId);
  if (box.seen.has(key)) {
    return { ok: true, status: 200, duplicate: true };
  }
  box.seen.add(key);

  if (skillPayload) applySkillOutput(box, skillPayload);

  if (kind === "progress" || (kind === "unknown" && skillPayload)) {
    const progress = (inner.progress && typeof inner.progress === "object" ? inner.progress : {}) as Record<string, unknown>;
    const executed = (progress.skill_executed || inner.skill_executed) as { output?: unknown; result?: unknown } | undefined;
    if (executed?.output) applySkillOutput(box, executed.output);
    if (executed?.result) applySkillOutput(box, executed.result);
    if (box.queued) box.queued = mergeReply(box, box.queued);
    if (box.settled && !box.waiter) return { ok: true, status: 200, late: true };
    return { ok: true, status: 200 };
  }

  if (box.settled && !box.waiter) {
    return { ok: true, status: 200, late: true };
  }

  if (kind === "error") {
    const message = errorText(inner);
    const reply: AgentTurnResponse = {
      session_id: sessionId,
      messages: [{ id: `err-${Date.now()}`, role: "agent", text: message }],
      chips: [],
      panel: box.panel,
      lead_form: box.lead_form,
      lead: box.lead,
      signals: box.signals,
      done: false,
      source: "devrev",
    };
    settle(sessionId, box, reply);
    return { ok: true, status: 200 };
  }

  const normalized = toReply(sessionId, body, inner, box);
  if (!normalized) {
    return { ok: true, status: 200, ignored: true };
  }
  const merged = mergeReply(box, normalized);
  if (box.waiter) {
    if (merged.panel.outcome === "none") {
      scheduleSettle(sessionId, box, merged);
    } else {
      settle(sessionId, box, merged);
    }
  } else {
    box.queued = merged;
  }
  return { ok: true, status: 200 };
}

function scheduleSettle(sessionId: string, box: Inbox, merged: AgentTurnResponse): void {
  setTimeout(() => {
    const current = inboxes.get(sessionId);
    if (!current?.waiter) {
      if (current && !current.settled) current.queued = mergeReply(current, merged);
      return;
    }
    settle(sessionId, current, mergeReply(current, merged));
  }, SETTLE_GRACE_MS);
}

function extractSkillOutput(inner: Record<string, unknown>): unknown {
  const progress = inner.progress && typeof inner.progress === "object" ? (inner.progress as Record<string, unknown>) : {};
  const executed = (progress.skill_executed || inner.skill_executed) as Record<string, unknown> | undefined;
  const candidates = [
    executed?.output,
    executed?.result,
    inner.skill_output,
    inner.output,
    inner.result,
    inner,
  ];
  for (const candidate of candidates) {
    if (unwrapFitPayload(candidate)) return candidate;
  }
  return null;
}

function classify(inner: Record<string, unknown>): "challenge" | "progress" | "message" | "error" | "unknown" {
  if (inner.agent_response === "error" || inner.error) return "error";
  if (inner.agent_response === "progress" || (inner.progress && typeof inner.progress === "object")) return "progress";
  if (
    inner.agent_response === "message" ||
    Array.isArray(inner.messages) ||
    typeof inner.message === "string" ||
    inner.panel ||
    inner.lead_form
  ) {
    return "message";
  }
  if (extractSkillOutput(inner)) return "progress";
  return "unknown";
}

function errorText(inner: Record<string, unknown>): string {
  const err = inner.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") return String((err as { error?: string }).error || "DevRev agent error");
  return "DevRev agent error";
}

function unwrap(data: Record<string, unknown>): Record<string, unknown> {
  const payload = data.payload;
  if (payload && typeof payload === "object") {
    const inner = (payload as Record<string, unknown>).ai_agent_response;
    if (inner && typeof inner === "object") return inner as Record<string, unknown>;
    return payload as Record<string, unknown>;
  }
  if (data.ai_agent_response && typeof data.ai_agent_response === "object") {
    return data.ai_agent_response as Record<string, unknown>;
  }
  const typed = data.type;
  if (typeof typed === "string" && typed && data[typed] && typeof data[typed] === "object") {
    return data[typed] as Record<string, unknown>;
  }
  if (data.event && typeof data.event === "object") {
    return data.event as Record<string, unknown>;
  }
  return data;
}

function toReply(
  sessionId: string,
  data: Record<string, unknown>,
  inner: Record<string, unknown>,
  box: Inbox,
): AgentTurnResponse | null {
  const messages = asMessages(inner.messages || data.messages || inner.message);
  if (!messages.length) return null;
  const panel =
    panelFromSkillOutput(inner.panel) ||
    panelFromSkillOutput(extractSkillOutput(inner)) ||
    panelFromSkillOutput(inner) ||
    box.panel;
  return {
    session_id: sessionId,
    messages,
    chips: asChips(inner.chips || inner.suggested_replies || inner.options || data.chips),
    panel,
    lead_form: (inner.lead_form as LeadFormState) || null,
    lead: leadFromSkillOutput(inner.lead) || leadFromSkillOutput(inner) || null,
    signals: cleanSignals(inner.signals || data.signals || box.signals),
    done: Boolean(inner.done ?? data.done),
    source: "devrev",
  };
}

export function cancelWait(sessionId: string): void {
  const box = inboxes.get(sessionId);
  if (!box?.waiter) return;
  clearTimeout(box.waiter.timer);
  box.waiter = undefined;
}

/** Test helper — drop in-memory state between harness runs. */
export function resetDevRevWaiters(): void {
  for (const box of inboxes.values()) {
    if (box.waiter) clearTimeout(box.waiter.timer);
  }
  inboxes.clear();
  pageToDon.clear();
  donToPage.clear();
}
