import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CatalogUnavailable, fetchObjections } from "@/lib/catalog";

export default async function FaqPage() {
  let objections: Array<{ objection_id: string; objection: string; answer: string }> = [];
  let error: string | null = null;
  try {
    objections = (await fetchObjections()).objections;
  } catch (err) {
    error = err instanceof CatalogUnavailable ? err.message : "Catalog unavailable.";
  }

  return (
    <>
      <SiteHeader current="/faq" />
      <main className="section">
        <div className="wrap">
          <p className="kicker">FAQ</p>
          <h1>Answers from the storefront</h1>
          <p className="lede">These are catalog objections, not invented copy.</p>
          {error ? <p className="gap-note">{error}</p> : null}
          <div className="faq">
            {objections.map((o) => (
              <details key={o.objection_id}>
                <summary>{o.objection}</summary>
                <p>{o.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
