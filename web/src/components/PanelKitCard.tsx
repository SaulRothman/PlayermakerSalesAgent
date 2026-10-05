import Image from "next/image";

import type { PanelProduct } from "@/lib/agent-protocol";

const ROLE_LABEL: Record<string, string> = {
  core_kit: "Core kit",
  special_edition_kit: "Special edition",
  accessory: "Accessory",
};

export function PanelKitCard({ product, emphasized }: { product: PanelProduct; emphasized: boolean }) {
  const role = product.role ? ROLE_LABEL[product.role] || product.role.replace(/_/g, " ") : "";
  const availability =
    product.available === true ? "In stock" : product.available === false ? "Unavailable" : null;
  return (
    <article className={`panel-card ${emphasized ? "emphasized" : "soft"}`}>
      {product.image_url ? (
        <Image src={product.image_url} alt={product.name} width={320} height={320} />
      ) : (
        <div className="media" aria-hidden />
      )}
      <div className="card-body">
        <p className="role">{emphasized ? "Best match from the catalog" : role}</p>
        <div className="meta-row">
          <h3>{product.name}</h3>
          {product.price ? <span className="price">{product.price}</span> : null}
        </div>
        {product.what_it_does ? <p>{product.what_it_does}</p> : null}
        {availability ? <p className="panel-availability">{availability}</p> : null}
        {product.url ? (
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
