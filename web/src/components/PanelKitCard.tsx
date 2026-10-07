import type { PanelProduct } from "@/lib/agent-protocol";
import type { FunnelState } from "@/lib/funnel";

const ROLE_LABEL: Record<string, string> = {
  core_kit: "Core kit",
  special_edition_kit: "Special edition",
  accessory: "Accessory",
};

const KNOWN_URLS: Record<string, string> = {
  "playermaker-2.0": "https://www.playermaker.com/products/playermaker",
  cityplay: "https://www.playermaker.com/products/cityplay",
  "extra-straps": "https://www.playermaker.com/products/playermaker-cityplay-straps",
};

export function PanelKitCard({
  product,
  emphasized,
  state = emphasized ? "leading" : "candidate",
  reason,
  showOrder = true,
  orderTone = "secondary",
  badge = null,
}: {
  product: PanelProduct & { available?: boolean | null };
  emphasized: boolean;
  state?: FunnelState;
  reason?: string | null;
  showOrder?: boolean;
  orderTone?: "primary" | "secondary";
  badge?: "likely" | "best" | null;
}) {
  const role = product.role ? ROLE_LABEL[product.role] || product.role.replace(/_/g, " ") : "";
  const href = product.url || KNOWN_URLS[product.product_id] || "";
  const label = badge === "best" ? "Best match" : badge === "likely" ? "Likely fit" : role;
  return (
    <article className={`rank-row funnel-card ${state}`} data-product-id={product.product_id}>
      {product.image_url ? <img className="rank-thumb" src={product.image_url} alt="" /> : <div className="rank-thumb" />}
      <div className="rank-copy">
        {label ? <p className={`role${badge === "likely" ? " likely" : ""}`}>{label}</p> : null}
        <div className="meta-row">
          <h3>{product.name}</h3>
          {product.price ? <span className="price">{product.price}</span> : null}
        </div>
        {reason ? <p className="funnel-reason">{reason}</p> : null}
      </div>
      {showOrder && href ? (
        <a
          className={`btn order-pill${orderTone === "primary" ? "" : " order-quiet"}`}
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          Order
        </a>
      ) : null}
    </article>
  );
}
