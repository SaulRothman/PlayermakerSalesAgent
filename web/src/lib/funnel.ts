import type { PanelProduct, PanelState, BuyerSignals } from "@/lib/agent-protocol";

/** Catalogue card passed in from the server. Facts stay the catalog's. */
export type ShelfItem = {
  product_id: string;
  name: string;
  price: string;
  url: string | null;
  image_url: string | null;
  what_it_does: string;
  role: string;
  available: boolean | null;
};

export type FunnelState = "candidate" | "leading" | "fading" | "ruled_out";

export type FunnelCard = ShelfItem & {
  state: FunnelState;
  reason: string | null;
  showOrder: boolean;
};

export type FunnelBanner = { tone: "honest_no" | "lead"; text: string } | null;

const STATE_RANK: Record<FunnelState, number> = {
  leading: 0,
  candidate: 1,
  fading: 2,
  ruled_out: 3,
};

const UNDER_8 =
  "Playermaker says it is designed for footballers starting from 8 years old. Under 8 is outside the stated range.";
const TEAM =
  "The B2C catalog has individual kits only. Teams get separate packages — those SKUs are not in this product list.";

type Journey = {
  age?: number;
  city?: boolean;
  straps: boolean;
  team: boolean;
  goalkeeper: boolean;
  indoor: boolean;
};

export function readJourney(
  signals: BuyerSignals,
  messages: Array<{ role: string; text: string }>,
): Journey {
  const journey: Journey = {
    age: signals.age,
    city: signals.wants_man_city_content,
    straps: Boolean(signals.already_owns_kit && (signals.needs || []).some((n) => /strap/i.test(n))),
    team: signals.buyer_type === "team_or_club",
    goalkeeper: signals.position === "goalkeeper",
    indoor: (signals.environment || []).some((e) => /indoor|futsal/i.test(e)),
  };

  let pending: "city" | null = null;
  for (const message of messages) {
    const text = message.text.toLowerCase();
    if (message.role === "agent") {
      pending = /man city/.test(text) ? "city" : null;
      continue;
    }
    if (/goalkeeper|goalie|\bkeeper\b/.test(text)) journey.goalkeeper = true;
    if (/indoor|futsal/.test(text)) journey.indoor = true;
    if (/strap/.test(text)) journey.straps = true;
    if (/\bteam\b|whole squad|club buy/.test(text) && !/regular club/.test(text)) journey.team = true;
    if (pending === "city") {
      if (/^(yes|yeah|yep)\b/.test(text) || /man city|cityplay/.test(text)) journey.city = true;
      if (/^(no|nope)\b/.test(text) || /just the tracker|no city|don'?t/.test(text)) journey.city = false;
    }
  }
  return journey;
}

function dollars(price: string): number | null {
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cityPremium(shelf: ShelfItem[]): string {
  const core = dollars(shelf.find((p) => p.product_id === "playermaker-2.0")?.price || "");
  const city = dollars(shelf.find((p) => p.product_id === "cityplay")?.price || "");
  if (core == null || city == null || city <= core) return "extra for content you don't need";
  return `+$${Math.round(city - core)} for content you don't need`;
}

export function rankFunnel(
  shelf: ShelfItem[],
  signals: BuyerSignals,
  messages: Array<{ role: string; text: string }>,
  agent: PanelState | null,
): { cards: FunnelCard[]; banner: FunnelBanner } {
  const journey = readJourney(signals, messages);
  const premium = cityPremium(shelf);
  const cards: FunnelCard[] = shelf.map((item) => ({
    ...item,
    state: "candidate",
    reason: null,
    showOrder: false,
  }));

  const set = (id: string, state: FunnelState, reason: string | null = null) => {
    const card = cards.find((c) => c.product_id === id);
    if (card) {
      card.state = state;
      card.reason = reason;
    }
  };

  let banner: FunnelBanner = null;
  const kits = ["playermaker-2.0", "cityplay"];

  if (journey.age !== undefined && journey.age <= 7) {
    banner = { tone: "honest_no", text: `8+ only. ${UNDER_8}` };
    for (const card of cards) set(card.product_id, "ruled_out", "8+ only");
  } else if (journey.straps) {
    set("extra-straps", "leading");
    set("playermaker-2.0", "fading", "You already have the sensors.");
    set("cityplay", "fading", "You already have the sensors.");
  } else if (journey.team) {
    banner = { tone: "lead", text: TEAM };
    for (const card of cards) set(card.product_id, "ruled_out", "Team packages aren't sold as a boxed kit.");
  } else if (journey.age !== undefined && journey.age >= 8 && journey.city === true) {
    set("cityplay", "leading");
    set("playermaker-2.0", "fading", "no Man City content");
    set("extra-straps", "fading", "Not a tracker kit.");
  } else if (journey.age !== undefined && journey.age >= 8 && journey.city === false) {
    set("playermaker-2.0", "leading");
    set("cityplay", "fading", premium);
    set("extra-straps", "fading", "Not a tracker kit.");
  } else if (journey.city === true) {
    set("cityplay", "leading");
    set("playermaker-2.0", "fading", "no Man City content");
    set("extra-straps", "fading", "Not a tracker kit.");
  } else if (journey.city === false) {
    set("playermaker-2.0", "leading");
    set("cityplay", "fading", premium);
    set("extra-straps", "fading", "Not a tracker kit.");
  } else if ((journey.goalkeeper || journey.indoor) && (journey.age === undefined || journey.age >= 8)) {
    set("playermaker-2.0", "leading");
    set("extra-straps", "fading", "Not a tracker kit.");
  } else if (journey.age !== undefined && journey.age >= 8) {
    set("extra-straps", "fading", "Only if you already own a kit.");
    for (const id of kits) {
      const card = cards.find((c) => c.product_id === id);
      if (card && card.state === "ruled_out") set(id, "candidate");
    }
  }

  applyAgent(cards, agent);
  const converged = cards.some((c) => c.state === "leading");
  for (const card of cards) card.showOrder = converged && card.state === "leading" && Boolean(card.url);

  cards.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
  return { cards, banner };
}

function applyAgent(cards: FunnelCard[], agent: PanelState | null) {
  if (!agent) return;
  const fromAgent = new Map<string, PanelProduct>();
  for (const product of agent.products || []) fromAgent.set(product.product_id, product);
  for (const card of cards) {
    const match = fromAgent.get(card.product_id);
    if (!match) continue;
    if (match.name) card.name = match.name;
    if (match.price) card.price = match.price;
    if (match.url) card.url = match.url;
    if (match.image_url) card.image_url = match.image_url;
    if (match.what_it_does) card.what_it_does = match.what_it_does;
  }
  const winner = agent.emphasized_product_id;
  if ((agent.outcome === "match" || agent.outcome === "accessory") && winner) {
    for (const card of cards) {
      if (card.product_id === winner) {
        card.state = "leading";
        card.reason = null;
      } else if (card.state === "candidate") {
        card.state = "fading";
      }
    }
  }
  if (agent.outcome === "honest_no") {
    for (const card of cards) {
      card.state = "ruled_out";
      card.reason = card.reason || "8+ only";
    }
  }
}
