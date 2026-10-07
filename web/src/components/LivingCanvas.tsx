import { FormEvent, useState } from "react";

import type { CanvasCard, CanvasImageKey } from "@/lib/canvas-registry";
import type { FunnelCard, FunnelOutcome } from "@/lib/funnel";

import teams from "../../brand/images/for-teams.webp";
import boot from "../../brand/images/product-slide-boot.png";
import research from "../../brand/images/research-hero.webp";
import sensors from "../../brand/images/sensors-on-boot.webp";
import sizeGuide from "../../brand/images/size-guide-straps.png";
import stats from "../../brand/images/stats-app.jpg";
import { PanelKitCard } from "@/components/PanelKitCard";

const IMAGES: Record<Exclude<CanvasImageKey, "icons">, { src: string; alt: string }> = {
  sensors: { src: sensors.src, alt: "Playermaker sensors on a boot" },
  boot: { src: boot.src, alt: "Playermaker on a boot" },
  size: { src: sizeGuide.src, alt: "Strap size guide" },
  stats: { src: stats.src, alt: "Playermaker app stats" },
  research: { src: research.src, alt: "Playermaker research" },
};

export function LivingCanvas({
  pending,
  cards,
  funnel,
  outcome,
  captured,
  onCapture,
}: {
  pending: boolean;
  cards: CanvasCard[];
  funnel: FunnelCard[];
  outcome: FunnelOutcome | null;
  captured: boolean;
  onCapture: (outcome: "honest_no" | "lead", name: string, email: string) => void;
}) {
  return (
    <aside className="decide-panel" aria-label="Options">
      <p className="kicker">Options</p>
      {pending ? (
        <div className="canvas-thinking" role="status">
          <span className="canvas-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Narrowing…
        </div>
      ) : null}
      {outcome && outcome.mode !== "shelf" ? (
        <OutcomePane outcome={outcome} captured={captured} pending={pending} onCapture={onCapture} />
      ) : null}
      {funnel.length ? (
        <div className="panel-grid funnel">
          {funnel.map((card) => (
            <PanelKitCard
              key={card.product_id}
              product={{ ...card, emphasized: card.state === "leading" }}
              emphasized={card.state === "leading"}
              state={card.state}
              reason={card.reason}
              showOrder={card.showOrder}
            />
          ))}
        </div>
      ) : null}
      {cards.length ? (
        <div className="panel-grid">
          {cards.map((card) => (
            <article key={card.id} className="topic-card">
              {card.imageKey && card.imageKey !== "icons" ? (
                <img src={IMAGES[card.imageKey].src} alt={IMAGES[card.imageKey].alt} />
              ) : null}
              {card.id === "accuracy" ? (
                <div className="topic-icons">
                  <img src="/brand/research-icon-1.svg" alt="" />
                  <img src="/brand/research-icon-2.svg" alt="" />
                  <img src="/brand/research-icon-3.svg" alt="" />
                </div>
              ) : null}
              <div className="card-body">
                <h3>{card.title}</h3>
                <p className="topic-body">{card.body}</p>
                {card.footnote ? <p className="gap-note">{card.footnote}</p> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function OutcomePane({
  outcome,
  captured,
  pending,
  onCapture,
}: {
  outcome: FunnelOutcome;
  captured: boolean;
  pending: boolean;
  onCapture: (outcome: "honest_no" | "lead", name: string, email: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const tone = outcome.mode === "honest_no" ? "warm" : outcome.mode === "lead" ? "teams" : "note";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (outcome.mode !== "honest_no" && outcome.mode !== "lead") return;
    if (!name.trim() || !email.trim() || pending) return;
    onCapture(outcome.mode, name.trim(), email.trim());
  }

  return (
    <section className={`outcome-pane ${tone}`} aria-live="polite">
      {outcome.mode === "lead" ? <img src={teams.src} alt="Playermaker for teams" /> : null}
      <h2>{outcome.headline}</h2>
      <p>{outcome.body}</p>
      {outcome.href ? (
        <a className="btn secondary outcome-link" href={outcome.href} target="_blank" rel="noreferrer">
          For Teams page
        </a>
      ) : null}
      {outcome.actionLabel && (outcome.mode === "honest_no" || outcome.mode === "lead") ? (
        captured ? (
          <p className="lead-note">Noted. We’ll follow up at the email you left.</p>
        ) : (
          <form className="lead-form" onSubmit={submit}>
            <label className="lead-field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required disabled={pending} />
            </label>
            <label className="lead-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={pending}
              />
            </label>
            <button className="btn" type="submit" disabled={pending || !name.trim() || !email.trim()}>
              {outcome.actionLabel}
            </button>
          </form>
        )
      ) : null}
    </section>
  );
}
