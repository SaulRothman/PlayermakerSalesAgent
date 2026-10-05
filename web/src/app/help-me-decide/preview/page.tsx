import { PanelKitCard } from "@/components/PanelKitCard";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchFitMatch } from "@/lib/catalog";
import { panelFromSkillOutput } from "@/server/devrev-parse";

export const dynamic = "force-dynamic";

async function Case({
  title,
  signals,
}: {
  title: string;
  signals: Record<string, unknown>;
}) {
  const match = await fetchFitMatch(signals);
  const panel = panelFromSkillOutput(match);
  const products = panel?.products || [];
  const emphasized = panel?.emphasized_product_id;
  return (
    <section className="decide-panel has-products" aria-label={title}>
      <p className="kicker">Options · {title}</p>
      {panel?.why ? <p className="panel-why">{panel.why}</p> : null}
      {products.length ? (
        <div className="panel-grid">
          {products.map((p) => (
            <PanelKitCard
              key={p.product_id}
              product={p}
              emphasized={Boolean(p.emphasized || p.product_id === emphasized)}
            />
          ))}
        </div>
      ) : (
        <p className="lede">No product cards for {panel?.outcome || "unknown"}.</p>
      )}
    </section>
  );
}

export default async function PanelPreviewPage() {
  return (
    <>
      <SiteHeader current="/help-me-decide" />
      <main className="decide">
        <div className="wrap" style={{ display: "grid", gap: 28 }}>
          <h1>Options panel fixtures</h1>
          <p className="lede">Catalog skill output rendered as orderable cards. Same component as Help me decide.</p>
          <Case title="15yo tracker-only → Playermaker 2.0" signals={{ age: 15, wants_man_city_content: false }} />
          <Case title="Man City → CITYPLAY" signals={{ age: 12, wants_man_city_content: true }} />
        </div>
      </main>
    </>
  );
}
