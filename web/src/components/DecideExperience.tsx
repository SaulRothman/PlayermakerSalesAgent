"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";

import type {
  AgentChip,
  AgentMessage,
  AgentTurnResponse,
  BuyerSignals,
  LeadFormState,
  LeadProfile,
  LeadResult,
  PanelState,
  UtmContext,
} from "@/lib/agent-protocol";

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

function DecideHeader({ onHelp, started }: { onHelp: () => void; started: boolean }) {
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link className="brand" href="/">
          Playermaker
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link href="/products">Kits</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/faq">FAQ</Link>
        </nav>
        <button className="btn" type="button" onClick={onHelp} aria-current={started ? "page" : undefined}>
          Help me decide
        </button>
      </div>
    </header>
  );
}

export function DecideExperience() {
  const [sessionId, setSessionId] = useState("");
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [chips, setChips] = useState<AgentChip[]>([]);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadForm, setLeadForm] = useState<LeadFormState | null>(null);
  const [lead, setLead] = useState<LeadResult | null>(null);
  const [parentName, setParentName] = useState("");
  const [email, setEmail] = useState("");
  const [signals, setSignals] = useState<BuyerSignals>({});
  const startedRef = useRef(false);

  const emphasized = panel?.emphasized_product_id;

  const sortedPanel = useMemo(() => {
    const products = panel?.products || [];
    return [...products].sort((a, b) => Number(b.product_id === emphasized) - Number(a.product_id === emphasized));
  }, [panel, emphasized]);

  async function send(
    input_type: "start" | "chip" | "text" | "lead",
    message: string,
    chip_id?: string,
    profile?: LeadProfile,
  ) {
    const sid = sessionId || newSessionId();
    if (!sessionId) setSessionId(sid);
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
          signals,
          utm: readUtm(),
          source: harness ? "async-harness" : "help-me-decide",
          ...(harness ? { timeout_ms: 20_000 } : {}),
        }),
      });
      const data = (await res.json()) as AgentTurnResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Agent error");
      setMessages((m) => [...m, ...data.messages]);
      setChips(data.chips || []);
      setPanel(data.panel);
      setLeadForm(data.lead_form);
      setLead(data.lead);
      if (data.signals) setSignals(data.signals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the store manager.");
    } finally {
      setPending(false);
    }
  }

  function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    setMessages([]);
    setChips([]);
    setPanel(null);
    setLeadForm(null);
    setLead(null);
    setParentName("");
    setEmail("");
    setSignals({});
    void send("start", "");
  }

  function onLeadSubmit(e: FormEvent) {
    e.preventDefault();
    const name = parentName.trim();
    const mail = email.trim();
    if (!name || !mail || pending) return;
    void send("lead", "", undefined, { parent_name: name, email: mail });
  }

  function onChip(chip: AgentChip) {
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
      <DecideHeader onHelp={start} started={started} />
      {!started ? (
        <main>
          <section className="hero">
            <div className="wrap">
              <p className="kicker">Help me decide</p>
              <h1>Talk to a store manager, not a quiz.</h1>
              <p className="lede">
                You are buying for a child. We’ll talk about that child — then show kits from the catalog, or
                tell you this isn’t for them.
              </p>
              <div className="hero-actions">
                <button className="btn" type="button" onClick={start}>
                  Help me decide
                </button>
                <Link className="btn secondary" href="/products">
                  See the kits
                </Link>
              </div>
            </div>
          </section>
        </main>
      ) : (
        <main className="decide">
          <div className="wrap decide-panes">
            <section className="decide-chat" aria-label="Conversation">
              <ol className="transcript" aria-busy={pending} aria-live="polite">
                {messages.map((m) => (
                  <li key={m.id} className={`bubble ${m.role}`}>
                    {m.text}
                  </li>
                ))}
                {pending ? (
                  <li className="bubble agent pending" data-thinking="true">
                    Thinking…
                  </li>
                ) : null}
              </ol>
              {error ? <p className="gap-note">{error}</p> : null}
              {chips.length ? (
                <div className="chips" aria-label="Suggested answers">
                  {chips.map((c) => (
                    <button key={c.id} type="button" className="chip" disabled={pending} onClick={() => onChip(c)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : null}
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
            </section>
            <aside className={`decide-panel${sortedPanel.length ? " has-products" : ""}`} aria-label="Product options">
              <p className="kicker">Options</p>
              {panel?.why ? <p className="panel-why">{panel.why}</p> : null}
              {panel?.outcome === "honest_no" ? (
                <p className="gap-note">This isn’t a fit. We won’t push a kit.</p>
              ) : null}
              {sortedPanel.length ? (
                <div className="panel-grid">
                  {sortedPanel.map((p) => (
                    <article
                      key={p.product_id}
                      className={`panel-card ${p.emphasized || p.product_id === emphasized ? "emphasized" : "soft"}`}
                    >
                      {p.image_url ? (
                        <Image src={p.image_url} alt={p.name} width={320} height={320} />
                      ) : (
                        <div className="media" />
                      )}
                      <div className="card-body">
                        <p className="role">{p.emphasized ? "Best match from the catalog" : p.role.replace(/_/g, " ")}</p>
                        <div className="meta-row">
                          <h3>{p.name}</h3>
                          <span className="price">{p.price}</span>
                        </div>
                        <p>{p.what_it_does}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="lede">Kits will show up here when the store manager has something to show.</p>
              )}
            </aside>
          </div>
        </main>
      )}
    </>
  );
}
