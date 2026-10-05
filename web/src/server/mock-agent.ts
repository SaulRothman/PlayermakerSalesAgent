/**
 * Scripted store-manager stand-in until Phase 6.
 * Asks questions, calls the catalog API, and offers lead capture — the browser does none of that.
 */
import "server-only";

import { fetchCaptureLead, fetchFitMatch } from "@/lib/catalog";
import { absorbBuyerSignals, cleanSignals, mergeSignals } from "@/lib/signals";
import { panelFromSkillOutput } from "@/server/devrev-parse";
import type {
  AgentChip,
  AgentMessage,
  AgentTurnRequest,
  AgentTurnResponse,
  BuyerSignals,
  LeadFormState,
  LeadResult,
  PanelState,
} from "@/lib/agent-protocol";

type Signals = BuyerSignals & { play_level?: string };

type Session = {
  signals: Signals;
  asked: Set<string>;
  panel: PanelState;
  leadOffered: boolean;
  leadCaptured: boolean;
};

const sessions = new Map<string, Session>();

function emptyPanel(): PanelState {
  return { outcome: "none", emphasized_product_id: null, products: [], why: null };
}

function session(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { signals: {}, asked: new Set(), panel: emptyPanel(), leadOffered: false, leadCaptured: false };
    sessions.set(id, s);
  }
  return s;
}

function msg(text: string): AgentMessage {
  return { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: "agent", text };
}

async function catalogPanel(signals: Signals): Promise<PanelState> {
  const match = await fetchFitMatch(signals);
  const fromSkill = panelFromSkillOutput(match);
  if (fromSkill) return fromSkill;
  return { outcome: "none", emphasized_product_id: null, products: [], why: null };
}

function absorbText(signals: Signals, text: string, chipId?: string): void {
  const next = absorbBuyerSignals(signals, text, chipId);
  Object.assign(signals, next);
  const t = text.toLowerCase();
  const id = (chipId || "").toLowerCase();
  if (id === "casual" || id === "regular-club" || id === "competitive") {
    signals.play_level = id;
  } else if (/casual/.test(t)) signals.play_level = "casual";
  else if (/competitive|travel|ecnl|academy/.test(t)) signals.play_level = "competitive";
  else if (/club|regular/.test(t)) signals.play_level = "regular-club";
}

function extractEmail(text: string): string | undefined {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : undefined;
}

const AGE_CHIPS: AgentChip[] = [
  { id: "under-8", label: "Under 8" },
  { id: "8-10", label: "8–10" },
  { id: "11-13", label: "11–13" },
  { id: "14-17", label: "14–17" },
  { id: "18-plus", label: "18+" },
];

const PLAY_CHIPS: AgentChip[] = [
  { id: "casual", label: "Casual" },
  { id: "regular-club", label: "Regular club" },
  { id: "competitive", label: "Competitive" },
];

const CITY_CHIPS: AgentChip[] = [
  { id: "man-city-yes", label: "Yes — Man City content" },
  { id: "man-city-no", label: "No — just the tracker" },
];

const SKIP_CHIP: AgentChip = { id: "lead-skip", label: "No thanks" };

function leadFormFor(outcome: PanelState["outcome"]): LeadFormState {
  const honest = outcome === "honest_no";
  const team = outcome === "lead";
  return {
    show: true,
    title: honest ? "Keep a note (optional)" : team ? "Route this as a team lead" : "Send this recap",
    body: honest
      ? "I still won’t sell you a kit. Leave a name and email if you want a note when they’re older."
      : team
        ? "This isn’t a boxed kit. Name and email and I’ll route it to the team desk."
        : "Name and email and I’ll pass this recap to the team.",
    submit_label: "Send my email",
    fields: [
      { id: "parent_name", label: "Your name", type: "text", required: true },
      { id: "email", label: "Email", type: "email", required: true },
    ],
  };
}

function catalogSignals(signals: Signals): BuyerSignals {
  return cleanSignals(signals);
}

function reply(
  turn: AgentTurnRequest,
  messages: AgentMessage[],
  extras: {
    chips?: AgentChip[];
    panel?: PanelState;
    lead_form?: LeadFormState | null;
    lead?: LeadResult | null;
    done?: boolean;
    signals?: Signals;
  },
): AgentTurnResponse {
  return {
    session_id: turn.session_id,
    messages,
    chips: extras.chips || [],
    panel: extras.panel || emptyPanel(),
    lead_form: extras.lead_form ?? null,
    lead: extras.lead ?? null,
    signals: catalogSignals(extras.signals || {}),
    done: Boolean(extras.done),
    source: "mock",
  };
}

function offerLead(turn: AgentTurnRequest, s: Session, recap: string, panel: PanelState): AgentTurnResponse {
  s.panel = panel;
  s.leadOffered = true;
  const form = leadFormFor(panel.outcome);
  return reply(turn, [msg(recap), msg(form.body)], {
    chips: [SKIP_CHIP],
    panel,
    lead_form: form,
    signals: s.signals,
    done: false,
  });
}

async function finishLead(
  turn: AgentTurnRequest,
  s: Session,
  parentName: string,
  email: string,
): Promise<AgentTurnResponse> {
  const captured = await fetchCaptureLead({
    session_id: turn.session_id,
    parent_name: parentName,
    email,
    outcome: s.panel.outcome,
    product_id: s.panel.emphasized_product_id,
    why: s.panel.why,
    signals: catalogSignals(s.signals),
    utm: turn.utm || {},
    source: turn.source || "help-me-decide",
  });
  const raw = (captured.lead || captured) as Record<string, unknown>;
  const pipeline = (raw.pipeline || {}) as Record<string, unknown>;
  s.leadCaptured = true;
  const dest = pipeline.destination === "devrev" ? "devrev" : "local";
  return reply(
    turn,
    [msg("Logged. I won’t keep pitching — someone on the team has the note if you need them.")],
    {
      panel: s.panel,
      lead_form: null,
      lead: {
        captured: true,
        destination: dest,
        lead_id: typeof raw.lead_id === "string" ? raw.lead_id : null,
        contact_id: typeof pipeline.contact_display_id === "string" ? pipeline.contact_display_id : null,
        work_id: typeof pipeline.work_display_id === "string" ? pipeline.work_display_id : null,
      },
      signals: s.signals,
      done: true,
    },
  );
}

export async function runMockAgent(turn: AgentTurnRequest): Promise<AgentTurnResponse> {
  const s = session(turn.session_id);

  if (turn.input_type === "start") {
    s.signals = {};
    s.asked = new Set(["age"]);
    s.panel = emptyPanel();
    s.leadOffered = false;
    s.leadCaptured = false;
    return reply(
      turn,
      [
        msg(
          "I’m a store manager, not a quiz bot. I’ll ask a few things about your player — and I’ll say so if Playermaker isn’t for them. How old are they?",
        ),
      ],
      { chips: AGE_CHIPS, signals: s.signals },
    );
  }

  s.signals = mergeSignals(s.signals, cleanSignals(turn.signals));

  if (s.leadCaptured) {
    return reply(turn, [msg("I already have your note. I won’t keep asking.")], {
      panel: s.panel,
      signals: s.signals,
      done: true,
    });
  }

  if (turn.chip_id === "lead-skip") {
    return reply(turn, [msg("All good. No email, no follow-up.")], {
      panel: s.panel,
      signals: s.signals,
      done: true,
    });
  }

  if (turn.input_type === "lead" || (s.leadOffered && (turn.profile?.email || extractEmail(turn.message)))) {
    const email = (turn.profile?.email || extractEmail(turn.message) || "").trim();
    const parentName = (turn.profile?.parent_name || "").trim();
    if (!email) {
      return reply(turn, [msg("I need an email to log this.")], {
        chips: [SKIP_CHIP],
        panel: s.panel,
        lead_form: leadFormFor(s.panel.outcome),
        signals: s.signals,
      });
    }
    if (!parentName) {
      return reply(turn, [msg("And your name — just so the note isn’t anonymous.")], {
        chips: [SKIP_CHIP],
        panel: s.panel,
        lead_form: leadFormFor(s.panel.outcome),
        signals: s.signals,
      });
    }
    return finishLead(turn, s, parentName, email);
  }

  if (s.leadOffered) {
    return reply(turn, [msg("Name and email in the form, or tap No thanks.")], {
      chips: [SKIP_CHIP],
      panel: s.panel,
      lead_form: leadFormFor(s.panel.outcome),
      signals: s.signals,
    });
  }

  absorbText(s.signals, turn.message, turn.chip_id);

  if (s.signals.age !== undefined && s.signals.age <= 7) {
    const panel = await catalogPanel({ age: s.signals.age });
    return offerLead(
      turn,
      s,
      "Playermaker is designed for footballers starting from 8. If they’re under 8, this isn’t the right time — and I won’t talk you into it.",
      panel,
    );
  }

  if (s.signals.buyer_type === "team_or_club") {
    const panel = await catalogPanel({ buyer_type: "team_or_club", age: s.signals.age });
    return offerLead(
      turn,
      s,
      "A team or club buy isn’t a kit on this storefront. I’d take that as a lead for the team packages — I won’t pretend a $199 box is the squad solution.",
      panel,
    );
  }

  if (s.signals.already_owns_kit && s.signals.needs?.length) {
    const panel = await catalogPanel(s.signals);
    return offerLead(turn, s, panel.why || "Extra Straps are the accessory if you already have a kit.", panel);
  }

  if (s.signals.age === undefined) {
    s.asked.add("age");
    return reply(turn, [msg("I still need their age before I can be honest with you. How old is the player?")], {
      chips: AGE_CHIPS,
      signals: s.signals,
    });
  }

  if (!s.signals.play_level && !s.asked.has("play")) {
    s.asked.add("play");
    return reply(turn, [msg("Got it. How do they play right now?")], { chips: PLAY_CHIPS, signals: s.signals });
  }

  if (s.signals.wants_man_city_content === undefined && !s.asked.has("city")) {
    s.asked.add("city");
    return reply(
      turn,
      [
        msg(
          "Both kits use the same foot-mounted sensors. CITYPLAY adds Manchester City coaching content in the app. Do they want that, or just the tracker?",
        ),
      ],
      { chips: CITY_CHIPS, signals: s.signals },
    );
  }

  if (s.signals.wants_man_city_content === undefined) {
    return reply(turn, [msg("Last one: Man City content in the app, or just the tracker?")], {
      chips: CITY_CHIPS,
      signals: s.signals,
    });
  }

  const panel = await catalogPanel(s.signals);
  const name = panel.products.find((p) => p.emphasized)?.name;
  const recap =
    panel.outcome === "honest_no"
      ? panel.why || "This isn’t the right fit."
      : name
        ? `For this player I’d point you to ${name}. ${panel.why || ""}`
        : panel.why || "I don’t have enough from the catalog to pick a kit.";

  return offerLead(turn, s, recap.trim(), panel);
}
