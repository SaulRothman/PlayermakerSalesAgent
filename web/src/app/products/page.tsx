import { ProductCard } from "@/components/ProductCard";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CatalogUnavailable, fetchProducts } from "@/lib/catalog";
import type { Product } from "@/lib/types";

export default async function ProductsPage() {
  let products: Product[] = [];
  let error: string | null = null;
  try {
    products = (await fetchProducts()).products;
  } catch (err) {
    error = err instanceof CatalogUnavailable ? err.message : "Catalog unavailable.";
  }

  return (
    <>
      <SiteHeader current="/products" />
      <main className="section">
        <div className="wrap">
          <p className="kicker">Catalog</p>
          <h1>Kits and straps</h1>
          <p className="lede">Names, prices, and copy come from the catalog API. Nothing is guessed.</p>
          {error ? (
            <p className="gap-note">{error}</p>
          ) : (
            <div className="product-grid">
              {products.map((p) => (
                <ProductCard key={p.product_id} product={p} />
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
