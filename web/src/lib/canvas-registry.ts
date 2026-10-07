import type { CatalogObjections, Product } from "@/lib/types";

/** Topic cards for the right pane. Add an entry to grow toward ~40–50. Copy comes from the catalog. */
export type CanvasImageKey =
  | "sensors"
  | "boot"
  | "size"
  | "stats"
  | "research"
  | "icons";

export type CanvasCard = {
  id: string;
  title: string;
  body: string;
  imageKey: CanvasImageKey | null;
  footnote: string | null;
};

type Objection = CatalogObjections["objections"][number];

type CardDef = {
  id: string;
  objectionId?: string;
  imageKey: CanvasImageKey | null;
  pattern: RegExp;
  build?: (ctx: CatalogFacts) => Pick<CanvasCard, "title" | "body" | "footnote"> | null;
};

export type CatalogFacts = {
  objections: Objection[];
  products: Product[];
};

export const OPENING_CHIPS = [
  { id: "pick-kit", label: "Help me pick the right kit" },
  { id: "safe", label: "Is it safe — can it cause injury or get in the way?" },
  { id: "weight", label: "How heavy are the sensors?" },
  { id: "size", label: "What size do we need?" },
  { id: "gps", label: "How is this better than a GPS tracker?" },
  { id: "subscription", label: "Do we need a subscription?" },
];

export const FOLLOWUP_CHIPS = [
  { id: "why-not", label: "Why not the other one?" },
  { id: "for-child", label: "How is it for my child?" },
  { id: "sizing", label: "What about sizing?" },
  { id: "guarantee", label: "Is there a money-back guarantee?" },
];

export const DECIDER_CHIPS = [
  { id: "man-city-yes", label: "CITYPLAY (Man City edition)" },
  { id: "man-city-no", label: "Playermaker 2.0 (standard tracker)" },
];

const DEFS: CardDef[] = [
  {
    id: "weight",
    objectionId: "how-heavy-are-the-sensors",
    imageKey: "boot",
    pattern: /heavy|weight|\bgrams?\b|\boz\b/i,
  },
  {
    id: "disturb",
    objectionId: "do-the-sensors-affect-players-while-training-or-playing",
    imageKey: "sensors",
    pattern: /safe|injury|in the way|get in the way|disturb|affect/i,
  },
  {
    id: "water",
    objectionId: "are-the-sensors-waterproof-or-water-resistant",
    imageKey: "sensors",
    pattern: /water|rain|waterproof|submerge/i,
  },
  {
    id: "accuracy",
    objectionId: "how-accurate-is-playermaker",
    imageKey: "research",
    pattern: /accura|fifa|6-axis|sample|university|certif/i,
  },
  {
    id: "gps",
    objectionId: "what-makes-playermaker-better-than-gps-trackers",
    imageKey: "stats",
    pattern: /\bgps\b/i,
  },
  {
    id: "size",
    imageKey: "size",
    pattern: /\bsize\b|sizing|shoe size|what size/i,
    build: sizeCard,
  },
  {
    id: "compare",
    objectionId: "what-s-the-difference-between-playermaker-2-0-and-cityplay",
    imageKey: null,
    pattern: /other one|why not|cityplay|difference|2\.0/i,
    build: compareCard,
  },
  {
    id: "subscription",
    objectionId: "do-i-need-a-subscription-to-use-playermaker",
    imageKey: null,
    pattern: /subscription|membership/i,
  },
  {
    id: "guarantee",
    objectionId: "is-there-a-money-back-guarantee",
    imageKey: null,
    pattern: /money-back|guarantee|return/i,
  },
];

export function buildCanvasCards(facts: CatalogFacts): CanvasCard[] {
  const byId = new Map(facts.objections.map((o) => [o.objection_id, o]));
  const cards: CanvasCard[] = [];
  for (const def of DEFS) {
    if (def.build) {
      const built = def.build(facts);
      if (!built) continue;
      cards.push({ id: def.id, imageKey: def.imageKey, ...built });
      continue;
    }
    const objection = def.objectionId ? byId.get(def.objectionId) : undefined;
    if (!objection?.answer) continue;
    cards.push({
      id: def.id,
      title: objection.objection,
      body: objection.answer,
      imageKey: def.imageKey,
      footnote: null,
    });
  }
  return cards;
}

/** One graphic for the latest turn, so the pane illustrates the question being asked. */
export function cardForLatest(cards: CanvasCard[], messages: Array<{ role: string; text: string }>): CanvasCard | null {
  const last = [...messages].reverse().find((message) => message.text.trim());
  if (!last) return null;
  return (
    cards.find((card) => {
      const def = DEFS.find((item) => item.id === card.id);
      return def ? def.pattern.test(last.text) : false;
    }) || null
  );
}

export function cardsForTranscript(cards: CanvasCard[], transcript: string): CanvasCard[] {
  const text = transcript.trim();
  if (!text) return [];
  return cards.filter((card) => {
    const def = DEFS.find((d) => d.id === card.id);
    return def ? def.pattern.test(text) : false;
  });
}

function money(product: Product | undefined): string {
  const variant = product?.variants?.[0];
  if (!variant?.price) return "";
  const compact = variant.price.replace(/\.00$/, "");
  return variant.currency === "USD" ? `$${compact}` : `${variant.currency} ${compact}`;
}

function sizeCard(facts: CatalogFacts): Pick<CanvasCard, "title" | "body" | "footnote"> | null {
  const kit = facts.products.find((p) => p.product_id === "playermaker-2.0") || facts.products[0];
  const bands = kit?.fit?.size_shoe_bands || [];
  if (!bands.length) return null;
  const unlabeled = bands.some((b) => !b.size_system);
  return {
    title: "What size do we need?",
    body: bands.map((b) => `${b.label}: ${b.raw}`).join("\n"),
    footnote: unlabeled
      ? "The storefront does not label these bands UK / US / EU, and the ranges overlap. This is the size guide only — we will not pick a size from a shoe size."
      : null,
  };
}

function compareCard(facts: CatalogFacts): Pick<CanvasCard, "title" | "body" | "footnote"> | null {
  const objection = facts.objections.find((o) => o.objection_id === "what-s-the-difference-between-playermaker-2-0-and-cityplay");
  if (!objection?.answer) return null;
  const core = facts.products.find((p) => p.product_id === "playermaker-2.0");
  const city = facts.products.find((p) => p.product_id === "cityplay");
  const corePrice = money(core);
  const cityPrice = money(city);
  const prices =
    core && city && corePrice && cityPrice ? `${core.name} ${corePrice}. ${city.name} ${cityPrice}.` : "";
  return {
    title: objection.objection,
    body: prices ? `${objection.answer}\n\n${prices}` : objection.answer,
    footnote: null,
  };
}
