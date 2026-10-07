"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { AgentMarkdown } from "@/components/AgentMarkdown";
import { LivingCanvas } from "@/components/LivingCanvas";
import { SiteHeader } from "@/components/SiteHeader";
import type {
  AgentMessage,
  AgentTurnResponse,
  BuyerSignals,
  LeadFormState,
  LeadProfile,
  LeadResult,
  PanelState,
  UtmContext,
} from "@/lib/agent-protocol";
import { mergePanels } from "@/lib/agent-protocol";
import { absorbBuyerSignals } from "@/lib/signals";
import { cardsForTranscript, FOLLOWUP_CHIPS, OPENING_CHIPS, type CanvasCard } from "@/lib/canvas-registry";
import { rankFunnel, type ShelfItem } from "@/lib/funnel";

function newSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}`;
}

function readUtm(): UtmContext {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  return {
    source: q.get("utm_source") || undefined,
    medium: q.get("utm_medium") || undefined,
    campaign: q.get("utm_campaign") || undefined,
    content: q.get("utm_content") || undefined,
    term: q.get("utm_term") || undefined,
  };
}

export function DecideExperience({ cards, shelf }: { cards: CanvasCard[]; shelf: ShelfItem[] }) {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadForm, setLeadForm] = useState<LeadFormState | null>(null);
  const [lead, setLead] = useState<LeadResult | null>(null);
  const [parentName, setParentName] = useState("");
  const [email, setEmail] = useState("");
  const [signals, setSignals] = useState<BuyerSignals>({});
  const refreshGen = useRef(0);
  const transcriptRef = useRef<HTMLOListElement>(null);

  const recommended = panel?.outcome === "match" || panel?.outcome === "accessory";
  const suggested = recommended ? FOLLOWUP_CHIPS : OPENING_CHIPS;
  const funnel = useMemo(() => rankFunnel(shelf, signals, messages, panel), [shelf, signals, messages, panel]);
  const topicCards = useMemo(
    () => cardsForTranscript(cards, messages.filter((m) => m.role === "visitor").map((m) => m.text).join("\n")),
    [cards, messages],
  );

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  async function send(
    input_type: "start" | "chip" | "text" | "lead",
    message: string,
    chip_id?: string,
    profile?: LeadProfile,
  ) {
    const sid = sessionId || newSessionId();
    if (!sessionId) setSessionId(sid);
    let nextSignals = absorbBuyerSignals(signals, message, chip_id);
    const lastAgent = [...messages].reverse().find((m) => m.role === "agent")?.text.toLowerCase() || "";
    if (/man city/.test(lastAgent)) {
      if (/^(yes|yeah|yep)\b/i.test(message)) nextSignals = { ...nextSignals, wants_man_city_content: true };
      if (/^(no|nope)\b/i.test(message) || /just the tracker/i.test(message)) {
        nextSignals = { ...nextSignals, wants_man_city_content: false };
      }
    }
    setSignals(nextSignals);
    refreshGen.current += 1;
    setPending(true);
    setError(null);
    if (input_type === "lead") {
      setMessages((m) => [...m, { id: `v-${Date.now()}`, role: "visitor", text: "I’ll leave my name and email." }]);
    } else if (input_type !== "start" && message) {
      setMessages((m) => [...m, { id: `v-${Date.now()}`, role: "visitor", text: message }]);
    }
    const harness =
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("async_harness") === "1";
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          message,
          input_type,
          chip_id,
          profile,
          signals: nextSignals,
          utm: readUtm(),
          source: harness ? "async-harness" : "help-me-decide",
          ...(harness ? { timeout_ms: 20_000 } : {}),
        }),
      });
      const data = (await res.json()) as AgentTurnResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Agent error");
      setMessages((m) => [...m, ...data.messages]);
      setPanel((prev) => mergePanels(prev, data.panel));
      setLeadForm(data.lead_form);
      setLead(data.lead);
      if (data.signals) setSignals(data.signals);
      if (data.source === "devrev" && !(data.panel?.products || []).length) {
        void refreshPanel(sid, ++refreshGen.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the store manager.");
    } finally {
      setPending(false);
    }
  }

  async function refreshPanel(sid: string, gen: number) {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (refreshGen.current !== gen) return;
      try {
        const res = await fetch(`/api/agent/session?session_id=${encodeURIComponent(sid)}`);
        if (!res.ok) continue;
        const snap = (await res.json()) as { panel?: PanelState };
        if (refreshGen.current !== gen) return;
        if (snap.panel?.products?.length) {
          setPanel((prev) => mergePanels(prev, snap.panel));
          return;
        }
      } catch {
        /* keep the last panel; next poll retries */
      }
    }
  }

  function onLeadSubmit(e: FormEvent) {
    e.preventDefault();
    const name = parentName.trim();
    const mail = email.trim();
    if (!name || !mail || pending) return;
    void send("lead", "", undefined, { parent_name: name, email: mail });
  }

  function onChip(chip: { id: string; label: string }) {
    if (pending) return;
    void send("chip", chip.label, chip.id);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = text.trim();
    if (!next || pending) return;
    setText("");
    void send("text", next);
  }

  return (
    <>
      <SiteHeader current="/help-me-decide" />
      <main className="decide">
        <div className="wrap decide-panes">
          <section className="decide-chat" aria-label="Conversation">
            <ol className="transcript" ref={transcriptRef} aria-busy={pending} aria-live="polite">
              {messages.length ? (
                messages.map((m) => (
                  <li key={m.id} className={`bubble ${m.role}`}>
                    {m.role === "agent" ? <AgentMarkdown text={m.text} /> : m.text}
                  </li>
                ))
              ) : (
                <li className="bubble agent">
                  Tell me about your player, or start with one of the questions below.
                </li>
              )}
            </ol>
            <div className="composer-dock">
              {error ? <p className="gap-note">{error}</p> : null}
              <div className="chips" aria-label="Suggested questions">
                {suggested.map((c) => (
                  <button key={c.id} type="button" className="chip" disabled={pending} onClick={() => onChip(c)}>
                    {c.label}
                  </button>
                ))}
              </div>
              {leadForm?.show ? (
                <form className="lead-form" onSubmit={onLeadSubmit}>
                  <p className="kicker">{leadForm.title}</p>
                  <p className="lead-form-body">{leadForm.body}</p>
                  {leadForm.fields.map((field) => (
                    <label key={field.id} className="lead-field">
                      <span>{field.label}</span>
                      <input
                        type={field.type}
                        name={field.id}
                        autoComplete={field.id === "email" ? "email" : "name"}
                        required={field.required}
                        value={field.id === "email" ? email : parentName}
                        onChange={(e) => (field.id === "email" ? setEmail(e.target.value) : setParentName(e.target.value))}
                        disabled={pending}
                      />
                    </label>
                  ))}
                  <button className="btn" type="submit" disabled={pending || !parentName.trim() || !email.trim()}>
                    {leadForm.submit_label}
                  </button>
                </form>
              ) : null}
              {lead?.captured ? (
                <p className="lead-note">
                  Note logged{lead.destination === "devrev" ? " to the DevRev pipeline" : ""}.
                </p>
              ) : null}
              <form className="composer" onSubmit={onSubmit}>
                <label className="sr-only" htmlFor="player-note">
                  Just tell me about your player
                </label>
                <textarea
                  id="player-note"
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Or just tell me about your player"
                  disabled={pending}
                />
                <button className="btn" type="submit" disabled={pending || !text.trim()}>
                  Send
                </button>
              </form>
            </div>
          </section>
          <LivingCanvas pending={pending} cards={topicCards} funnel={funnel.cards} banner={funnel.banner} />
        </div>
      </main>
    </>
  );
}
