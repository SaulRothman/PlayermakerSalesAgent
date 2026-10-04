import { NextResponse } from "next/server";

import type { AgentTurnRequest, AgentTurnResponse } from "@/lib/agent-protocol";
import { cleanSignals } from "@/lib/signals";
import { devrevConfigured, sendToDevRev } from "@/server/devrev-agent";
import { runMockAgent } from "@/server/mock-agent";
import { replyTimeoutMs, waitForWebhookReply } from "@/server/devrev-wait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: AgentTurnRequest;
  try {
    body = (await req.json()) as AgentTurnRequest;
  } catch {
    return bad("Invalid JSON");
  }
  if (!body?.session_id || !body.input_type) {
    return bad("session_id and input_type are required");
  }

  try {
    let result: AgentTurnResponse;
    if (body.source === "async-harness" && process.env.NODE_ENV !== "production") {
      const timeout = Number((body as { timeout_ms?: number }).timeout_ms);
      result = await waitForWebhookReply(body.session_id, cleanSignals(body.signals), replyTimeoutMs(timeout));
    } else if (devrevConfigured()) {
      result = await sendToDevRev(body);
    } else {
      result = await runMockAgent(body);
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
