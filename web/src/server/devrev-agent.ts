/**
 * Phase 6 DevRev adapter — async-only.
 *
 * execute-async body is exact:
 *   {
 *     agent,
 *     event: { input_message: { message } },
 *     session_object,                    // page session_id — plain text, not a DON
 *     webhook_target: { webhook }        // required; AI_AGENT_RESPONSE subscription
 *   }
 *
 * Reply → org webhook → POST /api/agent/events.
 *
 *   DEVREV_PAT=
 *   DEVREV_AGENT_ID=don:core:dvrv-us-1:devo/111SOeMpZI:ai_agent/73
 *   DEVREV_AGENT_ENDPOINT=https://api.devrev.ai/internal/ai-agents.events.execute-async
 *   DEVREV_WEBHOOK_ID=          (webhook DON — required)
 *   DEVREV_REPLY_TIMEOUT_MS=25000
 *
 * Never returns the PAT. devrevConfigured() is the mock ↔ live switch.
 */
import "server-only";

import type { AgentTurnRequest, AgentTurnResponse } from "@/lib/agent-protocol";
import { cleanSignals } from "@/lib/signals";
import { cancelWait, replyTimeoutMs, waitForWebhookReply } from "@/server/devrev-wait";

export { ingestDevRevEvent, waitForWebhookReply } from "@/server/devrev-wait";
export { leadFromSkillOutput, panelFromSkillOutput } from "@/server/devrev-parse";

export function devrevConfigured(): boolean {
  return Boolean(
    process.env.DEVREV_PAT?.trim() &&
      process.env.DEVREV_AGENT_ID?.trim() &&
      process.env.DEVREV_AGENT_ENDPOINT?.trim() &&
      process.env.DEVREV_WEBHOOK_ID?.trim(),
  );
}

function visitorMessage(turn: AgentTurnRequest): string {
  if (turn.input_type === "start") return "[start]";
  if (turn.input_type === "lead") {
    const name = turn.profile?.parent_name || "";
    const email = turn.profile?.email || "";
    return `[lead] session_id=${turn.session_id} parent_name=${name} email=${email}`;
  }
  return turn.message;
}

export async function sendToDevRev(turn: AgentTurnRequest): Promise<AgentTurnResponse> {
  const pat = process.env.DEVREV_PAT?.trim();
  const agentId = process.env.DEVREV_AGENT_ID?.trim();
  const endpoint = process.env.DEVREV_AGENT_ENDPOINT?.trim();
  const webhookId = process.env.DEVREV_WEBHOOK_ID?.trim();
  if (!pat || !agentId || !endpoint || !webhookId) {
    throw new Error("DevRev is not configured");
  }

  const signals = cleanSignals(turn.signals);
  const payload = {
    agent: agentId,
    event: { input_message: { message: visitorMessage(turn) } },
    session_object: turn.session_id,
    webhook_target: { webhook: webhookId },
  };

  const waiting = waitForWebhookReply(turn.session_id, signals, replyTimeoutMs());

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    cancelWait(turn.session_id);
    throw new Error(`DevRev agent ${res.status}`);
  }

  return waiting;
}
