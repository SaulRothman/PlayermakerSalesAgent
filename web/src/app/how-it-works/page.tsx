import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CatalogUnavailable, fetchProducts } from "@/lib/catalog";
import type { Product } from "@/lib/types";

export default async function HowItWorksPage() {
  let kit: Product | null = null;
  let error: string | null = null;
  try {
    const data = await fetchProducts();
    kit = data.products.find((p) => p.product_id === "playermaker-2.0") || data.products[0];
  } catch (err) {
    error = err instanceof CatalogUnavailable ? err.message : "Catalog unavailable.";
  }

  return (
    <>
      <SiteHeader current="/how-it-works" />
      <main className="section">
        <div className="wrap">
          <p className="kicker">How it works</p>
          <h1>Strap in. Play. Sync.</h1>
          {error || !kit ? (
            <p className="gap-note">{error || "No kit in catalog."}</p>
          ) : (
            <>
              <p className="lede">{kit.description.what_it_does}</p>
              <p>{kit.fit.attaches_how.summary}</p>
              <p>{kit.fit.disturbs_play.stated_effect}</p>
              <h2>What the catalog says it tracks</h2>
              <ul className="list">
                {kit.description.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {kit.fit.battery.session_limit_hours != null ? (
                <p>Session recording limit stated as {kit.fit.battery.session_limit_hours} hours. No battery capacity is published.</p>
              ) : null}
              {kit.fit.device_app_requirements.phone_needed_during_session === false ? (
                <p>Phone is not needed during the session. Bluetooth is used to sync.</p>
              ) : null}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
