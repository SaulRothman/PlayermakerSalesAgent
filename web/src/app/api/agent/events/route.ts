import { NextResponse } from "next/server";

import { ingestDevRevEvent } from "@/server/devrev-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DevRev may GET ?challenge= during setup. Never reads DEVREV_PAT. */
export async function GET(req: Request) {
  const challenge = new URL(req.url).searchParams.get("challenge");
  if (challenge) return NextResponse.json({ challenge });
  return NextResponse.json({ ok: true, expects: "POST verify | ai_agent_response" });
}

/**
 * DevRev webhook.
 * verify → 200 { challenge } (exact echo).
 * ai_agent_response → match session_object (page session_id) and settle the waiter.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = ingestDevRevEvent(body, req.headers);
  const type = String(body.type || body.event_type || (result.challenge ? "verify" : "?"));
  const inner = (() => {
    if (body.payload && typeof body.payload === "object") {
      const p = (body.payload as Record<string, unknown>).ai_agent_response;
      if (p && typeof p === "object") return p as Record<string, unknown>;
    }
    if (body.ai_agent_response && typeof body.ai_agent_response === "object") {
      return body.ai_agent_response as Record<string, unknown>;
    }
    return body;
  })();
  const meta = (inner.client_metadata && typeof inner.client_metadata === "object"
    ? inner.client_metadata
    : {}) as Record<string, unknown>;
  const session = String(
    body.session_object || body.session_id || inner.session_object || inner.session_id || meta.conversation_id || "",
  );
  const preview = String(inner.message || body.message || "").slice(0, 120);
  const flags = [
    result.challenge ? "verify-echo" : "",
    result.error || "",
    result.duplicate ? "duplicate" : "",
    result.late ? "late" : "",
    result.ignored ? "ignored" : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `[agent/events] type=${type} session=${session || "—"} http=${result.challenge ? 200 : result.status} ${flags}${preview ? ` preview=${JSON.stringify(preview)}` : ""}`,
  );
  if (result.challenge) {
    return NextResponse.json({ challenge: result.challenge });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Invalid event" }, { status: result.status || 400 });
  }
  return NextResponse.json({
    ok: true,
    duplicate: result.duplicate || false,
    late: result.late || false,
    ignored: result.ignored || false,
  });
}
