import Image from "next/image";
import Link from "next/link";

import { firstImage, firstPrice } from "@/lib/catalog";
import type { Product } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  core_kit: "Core kit",
  special_edition_kit: "Special edition",
  accessory: "Accessory",
};

export function ProductCard({ product }: { product: Product }) {
  const img = firstImage(product);
  const price = firstPrice(product);
  return (
    <article className="card">
      {img ? (
        <Image src={img} alt={product.name} width={600} height={600} />
      ) : (
        <div className="media" aria-hidden />
      )}
      <div className="card-body">
        <p className="role">{ROLE_LABEL[product.role] || product.role}</p>
        <div className="meta-row">
          <h3>{product.name}</h3>
          {price ? <span className="price">{price}</span> : null}
        </div>
        <p>{product.description.what_it_does}</p>
        <Link className="btn secondary" href={`/products/${product.product_id}`}>
          View {product.name}
        </Link>
      </div>
    </article>
  );
}
