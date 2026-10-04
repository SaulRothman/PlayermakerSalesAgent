import type { BuyerSignals } from "@/lib/agent-protocol";

export function emptySignals(): BuyerSignals {
  return {};
}

export function cleanSignals(raw?: unknown): BuyerSignals {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  const out: BuyerSignals = {};

  if (rec.age !== undefined && rec.age !== null && rec.age !== "") {
    const n = typeof rec.age === "number" ? rec.age : Number(rec.age);
    if (Number.isFinite(n)) out.age = Math.trunc(n);
  }
  if (typeof rec.wants_man_city_content === "boolean") out.wants_man_city_content = rec.wants_man_city_content;
  if (typeof rec.already_owns_kit === "boolean") out.already_owns_kit = rec.already_owns_kit;
  if (Array.isArray(rec.needs)) out.needs = rec.needs.map(String);
  if (typeof rec.buyer_type === "string" && rec.buyer_type.trim()) out.buyer_type = rec.buyer_type.trim();
  if (typeof rec.position === "string" && rec.position.trim()) out.position = rec.position.trim();
  if (Array.isArray(rec.environment)) out.environment = rec.environment.map(String);
  if (typeof rec.shoe_size === "string" && rec.shoe_size.trim()) out.shoe_size = rec.shoe_size.trim();
  if (typeof rec.shoe_size_system === "string" && rec.shoe_size_system.trim()) {
    out.shoe_size_system = rec.shoe_size_system.trim();
  }
  return out;
}

export function mergeSignals(base: BuyerSignals, incoming?: BuyerSignals): BuyerSignals {
  const next = { ...base };
  const add = incoming || {};
  if (add.age !== undefined) next.age = add.age;
  if (add.wants_man_city_content !== undefined) next.wants_man_city_content = add.wants_man_city_content;
  if (add.already_owns_kit !== undefined) next.already_owns_kit = add.already_owns_kit;
  if (add.needs !== undefined) next.needs = add.needs;
  if (add.buyer_type !== undefined) next.buyer_type = add.buyer_type;
  if (add.position !== undefined) next.position = add.position;
  if (add.environment !== undefined) next.environment = add.environment;
  if (add.shoe_size !== undefined) next.shoe_size = add.shoe_size;
  if (add.shoe_size_system !== undefined) next.shoe_size_system = add.shoe_size_system;
  return next;
}
