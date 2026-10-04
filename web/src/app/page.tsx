import Link from "next/link";

import { ProductCard } from "@/components/ProductCard";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CatalogUnavailable, fetchProducts } from "@/lib/catalog";
import type { Product } from "@/lib/types";

export default async function HomePage() {
  let products: Product[] = [];
  let catalogError: string | null = null;
  try {
    const data = await fetchProducts();
    products = data.products;
  } catch (err) {
    catalogError = err instanceof CatalogUnavailable ? err.message : "Catalog unavailable.";
  }

  return (
    <>
      <SiteHeader current="/" />
      <main>
        <section className="hero">
          <div className="wrap">
            <p className="kicker">For parents, not the player</p>
            <h1>Is this right for your child?</h1>
            <p className="lede">
              Playermaker is a foot-mounted soccer tracker. It is expensive and not for every kid. A store
              manager will help you decide — and will say no when it isn’t a fit.
            </p>
            <div className="hero-actions">
              <Link className="btn" href="/help-me-decide">
                Help me decide
              </Link>
              <Link className="btn secondary" href="/products">
                See the kits
              </Link>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <h2>On the shelf</h2>
            {catalogError ? (
              <p className="gap-note">{catalogError} No product names or prices are invented here.</p>
            ) : (
              <div className="product-grid">
                {products.map((p) => (
                  <ProductCard key={p.product_id} product={p} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <div className="sticky-cta">
        <Link className="btn" href="/help-me-decide" style={{ width: "100%" }}>
          Help me decide
        </Link>
      </div>
      <SiteFooter />
    </>
  );
}
