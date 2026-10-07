import { FormEvent, useLayoutEffect, useRef, useState } from "react";

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
  graphic,
  productsLead,
  funnel,
  outcome,
  captured,
  onCapture,
}: {
  pending: boolean;
  graphic: CanvasCard | null;
  productsLead: boolean;
  funnel: FunnelCard[];
  outcome: FunnelOutcome | null;
  captured: boolean;
  onCapture: (outcome: "honest_no" | "lead", name: string, email: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const tops = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const next = new Map<string, number>();
    root.querySelectorAll<HTMLElement>("[data-product-id]").forEach((node) => {
      const id = node.dataset.productId || "";
      const top = node.getBoundingClientRect().top;
      const previous = tops.current.get(id);
      if (previous != null && Math.abs(previous - top) > 1) {
        node.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], {
          duration: 250,
          easing: "ease",
        });
      }
      next.set(id, top);
    });
    tops.current = next;
  }, [funnel]);
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
      {graphic && !productsLead ? <TopicGraphic card={graphic} /> : null}
      {funnel.length ? (
        <div className="panel-grid funnel" ref={listRef}>
          {funnel.map((card) => (
            <PanelKitCard
              key={card.product_id}
              product={{ ...card, emphasized: card.badge === "best" }}
              emphasized={card.badge === "best"}
              state={card.state}
              reason={card.reason}
              showOrder={card.showOrder}
              orderTone={card.orderTone}
              badge={card.badge}
            />
          ))}
        </div>
      ) : null}
      {graphic && productsLead ? <TopicGraphic card={graphic} /> : null}
    </aside>
  );
}

function TopicGraphic({ card }: { card: CanvasCard }) {
  const image = card.imageKey && card.imageKey !== "icons" ? IMAGES[card.imageKey] : null;
  return (
    <article key={card.id} className="topic-card topic-swap">
      {image ? <img src={image.src} alt={image.alt} /> : null}
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
