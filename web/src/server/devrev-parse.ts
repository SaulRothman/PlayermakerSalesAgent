import type { AgentChip, AgentMessage, LeadResult, PanelProduct, PanelState } from "@/lib/agent-protocol";

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

function productCard(raw: Record<string, unknown>, emphasized: boolean): PanelProduct {
  return {
    product_id: String(raw.product_id || raw.id || ""),
    name: String(raw.name || raw.product_id || ""),
    price: String(raw.price || ""),
    image_url: typeof raw.image_url === "string" ? raw.image_url : null,
    role: String(raw.role || ""),
    what_it_does: String(raw.what_it_does || ""),
    emphasized,
  };
}

export function panelFromSkillOutput(output: unknown): PanelState | null {
  if (!output || typeof output !== "object") return null;
  const rec = output as Record<string, unknown>;
  if (Array.isArray(rec.products) && rec.outcome) {
    const emphasized = (rec.emphasized_product_id as string | null) || null;
    return {
      outcome: rec.outcome as PanelState["outcome"],
      emphasized_product_id: emphasized,
      products: (rec.products as Record<string, unknown>[]).map((p) =>
        productCard(p, Boolean(p.emphasized) || p.product_id === emphasized),
      ),
      why: typeof rec.why === "string" ? rec.why : null,
    };
  }
  if (rec.outcome && (rec.best_fit_product_id !== undefined || rec.why !== undefined || rec.product)) {
    const outcome = String(rec.outcome) as PanelState["outcome"];
    const emphasized = (rec.best_fit_product_id as string | null) || null;
    const products: PanelProduct[] = [];
    if (rec.product && typeof rec.product === "object") {
      products.push(productCard(rec.product as Record<string, unknown>, true));
    }
    for (const alt of (rec.alternatives as Record<string, unknown>[]) || []) {
      if (alt && typeof alt === "object") products.push(productCard(alt, false));
    }
    return {
      outcome:
        outcome === "match" ||
        outcome === "accessory" ||
        outcome === "honest_no" ||
        outcome === "lead" ||
        outcome === "need_more"
          ? outcome
          : "none",
      emphasized_product_id: emphasized,
      products,
      why: typeof rec.why === "string" ? rec.why : null,
    };
  }
  return null;
}

export function leadFromSkillOutput(output: unknown): LeadResult | null {
  if (!output || typeof output !== "object") return null;
  const rec = output as Record<string, unknown>;
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
