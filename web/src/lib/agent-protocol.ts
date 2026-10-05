/** Stable page ↔ proxy contract. Phase 6 DevRev adapter must emit this shape. */

export type AgentRole = "agent" | "visitor";

export type AgentMessage = {
  id: string;
  role: AgentRole;
  text: string;
};

export type AgentChip = {
  id: string;
  label: string;
};

export type PanelProduct = {
  product_id: string;
  name: string;
  price: string;
  image_url: string | null;
  url: string | null;
  role: string;
  what_it_does: string;
  available: boolean | null;
  emphasized: boolean;
};

export type PanelState = {
  outcome: "none" | "match" | "accessory" | "honest_no" | "lead" | "need_more";
  emphasized_product_id: string | null;
  products: PanelProduct[];
  why: string | null;
};

/** Keep a filled options panel across later chat turns that don't re-send products. */
export function mergePanels(prev: PanelState | null | undefined, next: PanelState | null | undefined): PanelState | null {
  if (!next) return prev || null;
  if (next.products.length) return next;
  if (next.outcome === "honest_no" || next.outcome === "lead" || next.outcome === "need_more") return next;
  if (prev?.products.length) {
    return { ...prev, why: next.why || prev.why, outcome: next.outcome !== "none" ? next.outcome : prev.outcome };
  }
  return next.outcome !== "none" || next.why ? next : prev || next;
}

export type UtmContext = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
};

/** Catalog BuyerSignals. Carried page → /api/agent → agent. Not training_frequency/goal. */
export type BuyerSignals = {
  age?: number;
  wants_man_city_content?: boolean;
  already_owns_kit?: boolean;
  needs?: string[];
  buyer_type?: string;
  position?: string;
  environment?: string[];
  shoe_size?: string;
  shoe_size_system?: string;
};

export type LeadProfile = {
  parent_name?: string;
  email?: string;
};

export type LeadFormField = {
  id: "parent_name" | "email";
  label: string;
  type: "text" | "email";
  required: boolean;
};

export type LeadFormState = {
  show: boolean;
  title: string;
  body: string;
  submit_label: string;
  fields: LeadFormField[];
};

export type LeadResult = {
  captured: boolean;
  destination: "local" | "devrev" | null;
  lead_id: string | null;
  contact_id: string | null;
  work_id: string | null;
};

export type AgentTurnRequest = {
  session_id: string;
  message: string;
  input_type: "start" | "chip" | "text" | "lead";
  chip_id?: string;
  profile?: LeadProfile;
  signals?: BuyerSignals;
  utm?: UtmContext;
  source?: string;
};

export type AgentTurnResponse = {
  session_id: string;
  messages: AgentMessage[];
  chips: AgentChip[];
  panel: PanelState;
  lead_form: LeadFormState | null;
  lead: LeadResult | null;
  signals: BuyerSignals;
  done: boolean;
  source: "mock" | "devrev";
};
