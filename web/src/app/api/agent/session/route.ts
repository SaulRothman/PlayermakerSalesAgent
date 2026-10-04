import { NextResponse } from "next/server";

import { peekSession } from "@/server/devrev-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Latest in-process panel for a page session. Used when skill_executed lands after the chat turn. */
export async function GET(req: Request) {
  const session_id = new URL(req.url).searchParams.get("session_id")?.trim();
  if (!session_id) return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  return NextResponse.json(peekSession(session_id));
}
