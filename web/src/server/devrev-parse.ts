import type { AgentChip, AgentMessage, LeadResult, PanelProduct, PanelState } from "@/lib/agent-protocol";
export { mergePanels } from "@/lib/agent-protocol";

const OUTCOMES = new Set(["match", "accessory", "honest_no", "lead", "need_more"]);

export function asMessages(raw: unknown): AgentMessage[] {
  if (typeof raw === "string" && raw.trim()) {
    return [{ id: `devrev-${Date.now()}`, role: "agent", text: raw.trim() }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      if (typeof item === "string") return { id: `devrev-${i}`, role: "agent" as const, text: item };
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const text = String(rec.text || rec.message || rec.body || "");
        if (!text) return null;
        return {
          id: String(rec.id || `devrev-${i}`),
          role: rec.role === "visitor" || rec.role === "user" ? ("visitor" as const) : ("agent" as const),
          text,
        };
      }
      return null;
    })
    .filter((m): m is AgentMessage => Boolean(m));
}

export function asChips(raw: unknown): AgentChip[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      if (typeof item === "string") return { id: `chip-${i}`, label: item };
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const label = String(rec.label || rec.display_name || rec.text || rec.id || "");
        if (!label) return null;
        return { id: String(rec.id || label), label };
      }
      return null;
    })
    .filter((c): c is AgentChip => Boolean(c));
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function looksLikeFit(rec: Record<string, unknown>): boolean {
  if (OUTCOMES.has(String(rec.outcome || ""))) return true;
  if (rec.best_fit_product_id) return true;
  if (rec.product && typeof rec.product === "object") return true;
  if (Array.isArray(rec.products) && rec.products.some(isProductish)) return true;
  if (Array.isArray(rec.alternatives) && rec.alternatives.some(isProductish)) return true;
  return false;
}

function isProductish(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return Boolean(rec.product_id || rec.id || rec.name);
}

/** DevRev HTTP skills often wrap the catalog JSON in body/data/output (sometimes as a string). */
export function unwrapFitPayload(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || raw == null) return null;
  const parsed = parseJson(raw);
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = unwrapFitPayload(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const rec = asRecord(parsed);
  if (!rec) return null;
  if (looksLikeFit(rec)) return rec;
  for (const value of Object.values(rec)) {
    const found = unwrapFitPayload(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function nestedString(raw: Record<string, unknown>, path: string[]): string {
  let cur: unknown = raw;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : "";
}

function formatPrice(raw: Record<string, unknown>): string {
  const variant =
    Array.isArray(raw.variants) && raw.variants[0] && typeof raw.variants[0] === "object"
      ? (raw.variants[0] as Record<string, unknown>)
      : {};
  const price = String(raw.price || variant.price || "").trim();
  if (!price) return "";
  if (/^[^\d]/.test(price)) return price.replace(/\.00$/, "");
  const currency = String(raw.currency || variant.currency || "USD");
  const compact = price.replace(/\.00$/, "");
  return currency === "USD" ? `$${compact}` : `${currency} ${compact}`;
}

function productCard(raw: Record<string, unknown>, emphasized: boolean): PanelProduct | null {
  const product_id = String(raw.product_id || raw.id || "").trim();
  const name = String(raw.name || product_id || "").trim();
  if (!product_id && !name) return null;
  const media0 =
    Array.isArray(raw.media) && raw.media[0] && typeof raw.media[0] === "object"
      ? (raw.media[0] as Record<string, unknown>)
      : {};
  const image =
    (typeof raw.image_url === "string" && raw.image_url) ||
    (typeof media0.url === "string" && media0.url) ||
    null;
  const url =
    (typeof raw.checkout_url === "string" && raw.checkout_url.trim()) ||
    (typeof raw.add_to_cart_url === "string" && raw.add_to_cart_url.trim()) ||
    (typeof raw.url === "string" && raw.url.trim()) ||
    null;
  const available =
    typeof raw.available === "boolean"
      ? raw.available
      : typeof raw.available === "string"
        ? raw.available.toLowerCase() === "true"
        : null;
  return {
    product_id: product_id || name,
    name: name || product_id,
    price: formatPrice(raw),
    image_url: image,
    url,
    role: String(raw.role || ""),
    what_it_does: String(raw.what_it_does || nestedString(raw, ["description", "what_it_does"]) || ""),
    available,
    emphasized,
  };
}

function collectProducts(rec: Record<string, unknown>, emphasized: string | null): PanelProduct[] {
  const cards: PanelProduct[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown, forceEmphasized: boolean) => {
    if (!raw || typeof raw !== "object") return;
    const card = productCard(raw as Record<string, unknown>, forceEmphasized);
    if (!card) return;
    if (seen.has(card.product_id)) return;
    seen.add(card.product_id);
    cards.push({
      ...card,
      emphasized: forceEmphasized || card.product_id === emphasized || Boolean((raw as { emphasized?: boolean }).emphasized),
    });
  };

  push(rec.product, true);
  if (Array.isArray(rec.products)) {
    for (const item of rec.products) push(item, false);
  }
  if (Array.isArray(rec.alternatives)) {
    for (const item of rec.alternatives) push(item, false);
  }
  return cards;
}

export function panelFromSkillOutput(output: unknown): PanelState | null {
  const rec = unwrapFitPayload(output);
  if (!rec) return null;

  const rawOutcome = String(rec.outcome || "");
  const outcome = OUTCOMES.has(rawOutcome) ? (rawOutcome as PanelState["outcome"]) : "none";
  const emphasized =
    (typeof rec.best_fit_product_id === "string" && rec.best_fit_product_id) ||
    (rec.product && typeof rec.product === "object"
      ? String((rec.product as Record<string, unknown>).product_id || "")
      : "") ||
    null;
  const hideCards = outcome === "honest_no" || outcome === "lead" || outcome === "need_more";
  const products = hideCards ? [] : collectProducts(rec, emphasized || null);

  if (!products.length && outcome === "none" && !rec.why) return null;

  const missing = Array.isArray(rec.missing_signals) ? rec.missing_signals.map(String).filter(Boolean) : [];
  return {
    outcome,
    emphasized_product_id: hideCards ? null : emphasized || products.find((p) => p.emphasized)?.product_id || null,
    products,
    why: typeof rec.why === "string" ? rec.why : null,
    ...(missing.length ? { missing_signals: missing } : {}),
  };
}

export function leadFromSkillOutput(output: unknown): LeadResult | null {
  const rec = asRecord(output);
  if (!rec) return null;
  const lead = (rec.lead && typeof rec.lead === "object" ? rec.lead : rec) as Record<string, unknown>;
  const pipeline = (lead.pipeline && typeof lead.pipeline === "object" ? lead.pipeline : {}) as Record<
    string,
    unknown
  >;
  if (!lead.lead_id && pipeline.destination !== "devrev" && pipeline.destination !== "local") return null;
  return {
    captured: true,
    destination: pipeline.destination === "devrev" ? "devrev" : "local",
    lead_id: typeof lead.lead_id === "string" ? lead.lead_id : null,
    contact_id:
      typeof pipeline.contact_display_id === "string"
        ? pipeline.contact_display_id
        : typeof pipeline.contact_id === "string"
          ? pipeline.contact_id
          : null,
    work_id:
      typeof pipeline.work_display_id === "string"
        ? pipeline.work_display_id
        : typeof pipeline.work_id === "string"
          ? pipeline.work_id
          : null,
  };
}
