import type { CanvasCard, CanvasImageKey } from "@/lib/canvas-registry";
import type { FunnelBanner, FunnelCard } from "@/lib/funnel";

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
  banner,
}: {
  pending: boolean;
  cards: CanvasCard[];
  funnel: FunnelCard[];
  banner: FunnelBanner;
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
      {banner ? <p className={banner.tone === "honest_no" ? "gap-note" : "panel-why"}>{banner.text}</p> : null}
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
