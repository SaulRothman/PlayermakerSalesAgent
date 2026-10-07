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
  orderTone: "primary" | "secondary";
  badge: "likely" | "best" | null;
};

export type FunnelMode = "shelf" | "honest_no" | "lead" | "accessory" | "need_more";

export type FunnelOutcome = {
  mode: FunnelMode;
  headline: string;
  body: string;
  actionLabel?: string;
  href?: string;
};

const STATE_RANK: Record<FunnelState, number> = {
  leading: 0,
  candidate: 1,
  fading: 2,
  ruled_out: 3,
};

const UNDER_8 =
  "Playermaker says it is designed for footballers starting from 8 years old. Under 8 is outside the stated range.";
const TEAM =
  "The B2C catalog has individual kits only. FAQ says teams get separate packages and a Coach Dashboard at different price points — those SKUs are not in the public product list.";
const STRAPS =
  "Extra Straps are the storefront accessory for holding existing Playermaker sensors; they are not a tracker kit.";
const FOR_TEAMS = "https://www.playermaker.com/pages/teams";

const SIGNAL_LABEL: Record<string, string> = {
  age: "their age",
  wants_man_city_content: "whether they want Man City content",
  already_owns_kit: "whether you already own a kit",
  buyer_type: "whether this is for one player or a team",
};

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
  const owns = signals.already_owns_kit === true;
  const wantsStraps = (signals.needs || []).some((n) => /strap/i.test(n));
  const journey: Journey = {
    age: signals.age,
    city: signals.wants_man_city_content,
    straps: owns && wantsStraps,
    team: signals.buyer_type === "team_or_club",
    goalkeeper: signals.position === "goalkeeper",
    indoor: (signals.environment || []).some((e) => /indoor|futsal/i.test(e)),
  };

  let pending: "city" | null = null;
  let saidOwns = owns;
  let saidStraps = wantsStraps;
  for (const message of messages) {
    const text = message.text.toLowerCase();
    if (message.role !== "visitor") {
      pending = /man city/.test(text) && /tracker|content/.test(text) ? "city" : null;
      continue;
    }
    if (/goalkeeper|goalie|\bkeeper\b/.test(text)) journey.goalkeeper = true;
    if (/\bindoor\b|futsal/.test(text)) journey.indoor = true;
    if (/already own|i own|we own|have (a |the )?kit|own (a |the )?kit/.test(text)) saidOwns = true;
    if (/extra strap|need straps|replacement strap|colou?red strap/.test(text)) saidStraps = true;
    if (/\bfor (the |a )?team\b|whole (team|squad)|club buy|team or club/.test(text)) journey.team = true;
    if (pending === "city") {
      if (/^(yes|yeah|yep)\b/.test(text) || /man city content|wants? man city|cityplay/.test(text)) journey.city = true;
      if (/^(no|nope)\b/.test(text) || /just the tracker|no man city/.test(text)) journey.city = false;
    }
  }
  journey.straps = saidOwns && saidStraps;
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
): { cards: FunnelCard[]; outcome: FunnelOutcome | null } {
  const journey = readJourney(signals, messages);
  const premium = cityPremium(shelf);
  const cards: FunnelCard[] = shelf.map((item) => ({
    ...item,
    state: "candidate",
    reason: null,
    showOrder: false,
    orderTone: "secondary",
    badge: null,
  }));

  const set = (id: string, state: FunnelState, reason: string | null = null) => {
    const card = cards.find((c) => c.product_id === id);
    if (card) {
      card.state = state;
      card.reason = reason;
    }
  };

  let outcome: FunnelOutcome | null = null;
  const kits = ["playermaker-2.0", "cityplay"];
  let mode: FunnelMode = "shelf";

  if (journey.age !== undefined && journey.age <= 7) {
    mode = "honest_no";
    outcome = {
      mode,
      headline: "Not just yet — Playermaker is built for ages 8+.",
      body: UNDER_8,
      actionLabel: "Email me when they're ready",
    };
    for (const card of cards) set(card.product_id, "ruled_out", "8+ only");
  } else if (journey.straps) {
    mode = "accessory";
    outcome = { mode, headline: "You just need straps.", body: STRAPS };
    set("extra-straps", "leading");
    set("playermaker-2.0", "ruled_out", "You already have the sensors.");
    set("cityplay", "ruled_out", "You already have the sensors.");
  } else if (journey.team) {
    mode = "lead";
    outcome = {
      mode,
      headline: "Teams get a dedicated package.",
      body: TEAM,
      actionLabel: "Connect me with the team desk",
      href: FOR_TEAMS,
    };
    for (const card of cards) set(card.product_id, "ruled_out", "Not a boxed kit for a squad.");
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
  } else if (journey.age !== undefined && journey.age >= 8) {
    set("extra-straps", "fading", "Only if you already own a kit.");
    for (const id of kits) {
      const card = cards.find((c) => c.product_id === id);
      if (card && card.state === "ruled_out") set(id, "candidate");
    }
  }

  if (!outcome && messages.some((m) => m.role === "visitor")) {
    const missing = missingLabels(journey, agent);
    if (missing.length && mode === "shelf" && !cards.some((c) => c.state === "leading")) {
      outcome = {
        mode: "need_more",
        headline: "A couple more questions and I'll narrow this down.",
        body: `Still need ${missing.join(" and ")}.`,
      };
    }
  }

  applyAgent(cards, agent, mode);
  const cityKnown = journey.city === true || journey.city === false;
  const locked = cityKnown || mode === "accessory";
  for (const card of cards) {
    const hideOrder = mode === "honest_no" || mode === "lead" || card.state === "ruled_out" || !card.url;
    card.showOrder = !hideOrder;
    card.orderTone = locked && card.state === "leading" ? "primary" : "secondary";
    if (locked && card.state === "leading") card.badge = "best";
    else if (!locked && card.state === "candidate" && (card.product_id === "playermaker-2.0" || card.product_id === "cityplay") && journey.age !== undefined && journey.age >= 8) {
      card.badge = "likely";
    } else card.badge = null;
  }

  cards.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
  return { cards, outcome };
}

function missingLabels(journey: Journey, agent: PanelState | null): string[] {
  const fromAgent = (agent?.missing_signals || []).map((id) => SIGNAL_LABEL[id] || id.replace(/_/g, " "));
  if (agent?.outcome === "need_more" && fromAgent.length) return fromAgent;
  const missing: string[] = [];
  if (journey.age === undefined) missing.push("their age");
  else if (journey.age >= 8 && journey.city === undefined && !journey.straps && !journey.team) {
    missing.push("whether they want Man City content");
  }
  return missing;
}

function applyAgent(cards: FunnelCard[], agent: PanelState | null, mode: FunnelMode) {
  if (!agent) return;
  if (agent.outcome === "honest_no" && mode !== "honest_no") return;
  if (agent.outcome === "lead" && mode !== "lead") return;
  if (agent.outcome === "accessory" && mode !== "accessory") return;
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
  const cityAnswered = mode !== "shelf" || cards.some((c) => c.state === "leading");
  const definiteMatch = (agent.outcome === "match" || agent.outcome === "accessory") && Boolean(winner);
  if (definiteMatch && (cityAnswered || agent.outcome === "accessory")) {
    for (const card of cards) {
      if (card.product_id === winner) {
        card.state = "leading";
        card.reason = null;
      } else if (card.state === "candidate" || card.state === "leading") {
        card.state = card.product_id === winner ? "leading" : "fading";
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
