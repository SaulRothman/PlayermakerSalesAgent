import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CatalogUnavailable, fetchProduct, firstPrice } from "@/lib/catalog";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { product, relevant_gaps } = await fetchProduct(id);
    const price = firstPrice(product);
    const img = product.media?.[0];
    const sizeUnlabeled = product.fit.size_shoe_bands.some((b) => !b.size_system);

    return (
      <>
        <SiteHeader current="/products" />
        <main className="section">
          <div className="wrap pdp">
            <div className="pdp-media">
              {img ? (
                <Image className="card" src={img.url} alt={img.alt || product.name} width={800} height={800} />
              ) : null}
            </div>
            <div>
              <p className="kicker">{product.role.replace(/_/g, " ")}</p>
              <h1>{product.name}</h1>
              {price ? <p className="price">{price}</p> : <p className="gap-note">Price missing in catalog.</p>}
              <p>{product.description.what_it_does}</p>
              {product.description.whats_included.length ? (
                <>
                  <h2>What’s included</h2>
                  <ul className="list">
                    {product.description.whats_included.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h2>Sizes</h2>
              {product.variants.map((v) => (
                <div className="variant" key={v.variant_id}>
                  <span>
                    {v.title}
                    {v.sku ? ` · ${v.sku}` : ""}
                  </span>
                  <span>
                    {v.currency === "USD" ? "$" : v.currency} {v.price}
                    {v.available === false ? " · unavailable" : ""}
                  </span>
                </div>
              ))}
              {product.fit.size_shoe_bands.map((b) => (
                <p key={b.label + b.raw}>
                  {b.label}: {b.raw}
                </p>
              ))}
              {sizeUnlabeled ? (
                <p className="gap-note">
                  Shoe bands are printed without a UK / US / EU label. We will not pick a size for you.
                </p>
              ) : null}
              {product.fit.supported_age_range.min != null ? (
                <p>Stated age floor: {product.fit.supported_age_range.min}+. No maximum age is in the catalog.</p>
              ) : null}
              {relevant_gaps.length ? (
                <p className="gap-note">
                  Catalog flags {relevant_gaps.length} gap{relevant_gaps.length === 1 ? "" : "s"} on this
                  product (conflicts or missing facts). We do not resolve them here.
                </p>
              ) : null}
              <div className="hero-actions">
                <Link className="btn" href="/help-me-decide">
                  Help me choose
                </Link>
                <a className="btn secondary" href={product.url}>
                  Official product page
                </a>
              </div>
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  } catch (err) {
    if (err instanceof CatalogUnavailable && err.message.includes("404")) notFound();
    return (
      <>
        <SiteHeader current="/products" />
        <main className="wrap error-box">
          <h1>Catalog unavailable</h1>
          <p className="gap-note">{err instanceof Error ? err.message : "Could not load this product."}</p>
        </main>
      </>
    );
  }
}
