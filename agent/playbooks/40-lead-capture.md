# Playbook — lead capture

Profile → email → `capture_lead` (223). Offer this after **every** terminal outcome, including honest-no.

## When
Immediately after you deliver the recap or the decline. Do not wait for them to ask.

## What you collect
- `parent_name` (required)
- `email` (required)
Do not collect the child’s email. Do not collect a card.

## Copy
Use `scripts/leads.md`. The page renders `lead_form` fields you send; chips include `No thanks`.

## Call 223 only when both fields are present

```json
{
  "session_id": "<id>",
  "parent_name": "...",
  "email": "...",
  "outcome": "honest_no | match | accessory | lead | need_more",
  "product_id": "<best_fit or null>",
  "why": "<from fit_match>",
  "signals": {},
  "utm": {},
  "source": "help-me-decide"
}
```

## After
- Success: `scripts/leads.md` logged line. Stop pitching.
- Skip: `scripts/leads.md` skip line. Stop.
- Missing name or email: ask only for the missing field. Keep `No thanks`.
