import Image from "next/image";

import type { PanelProduct } from "@/lib/agent-protocol";
import type { FunnelState } from "@/lib/funnel";

const ROLE_LABEL: Record<string, string> = {
  core_kit: "Core kit",
  special_edition_kit: "Special edition",
  accessory: "Accessory",
};

export function PanelKitCard({
  product,
  emphasized,
  state = emphasized ? "leading" : "candidate",
  reason,
  showOrder,
}: {
  product: PanelProduct & { available?: boolean | null };
  emphasized: boolean;
  state?: FunnelState;
  reason?: string | null;
  showOrder?: boolean;
}) {
  const role = product.role ? ROLE_LABEL[product.role] || product.role.replace(/_/g, " ") : "";
  const availability =
    product.available === true ? "In stock" : product.available === false ? "Unavailable" : null;
  const order = showOrder ?? (state === "leading" && Boolean(product.url));
  return (
    <article className={`panel-card funnel-card ${state}`}>
      {state !== "ruled_out" && product.image_url ? (
        <Image src={product.image_url} alt={product.name} width={320} height={320} />
      ) : null}
      <div className="card-body">
        <p className="role">{state === "leading" ? "Best match" : role}</p>
        <div className="meta-row">
          <h3>{product.name}</h3>
          {product.price ? <span className="price">{product.price}</span> : null}
        </div>
        {state !== "ruled_out" && product.what_it_does ? <p>{product.what_it_does}</p> : null}
        {reason ? <p className="funnel-reason">{reason}</p> : null}
        {state !== "ruled_out" && availability ? <p className="panel-availability">{availability}</p> : null}
        {order && product.url ? (
          <div className="panel-card-actions">
            <a className="btn order-pill" href={product.url} target="_blank" rel="noreferrer">
              Order
            </a>
          </div>
        ) : null}
      </div>
    </article>
  );
}
