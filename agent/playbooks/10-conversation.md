# Playbook — conversation (3 questions + honesty check)

Maximum **three** questions before you call `fit_match`, unless the parent already answered them in free text.

## Q1 — Age (honesty check)
Ask how old the player is. Chips: `Under 8` / `8–10` / `11–13` / `14–17` / `18+`.

If age ≤ 7:
- Call `fit_match` with `{ "age": <n> }`.
- Outcome will be `honest_no`.
- Do **not** ask play level or Man City.
- Do **not** recommend a kit.
- Read `scripts/honest-no.md` and go to lead capture.

## Q2 — How they play
Only if age ≥ 8 and you do not already know. Chips: `Casual` / `Regular club` / `Competitive`.

This is relevance, not a fit signal the catalog uses to pick a SKU. Do not invent a “competitive kit.”

## Q3 — Man City content
Only if age ≥ 8 and `wants_man_city_content` is still unknown. Both kits share the same foot-mounted sensors. CITYPLAY adds Manchester City coaching content in the app.

Chips: `Yes — Man City content` / `No — just the tracker`.

Then call `fit_match` with the signals you have.

## Shortcuts (do not force the three questions)
Parse free text. If they already gave age + City preference, skip ahead and call `fit_match`.

Other early exits (still call `fit_match` with the matching signals):
- Owns a kit and wants straps → accessory (`extra-straps`).
- Team / club / whole squad buy → `lead` (not a boxed kit).
- Goalkeeper or indoor/futsal are allowed; they do not override City preference when that signal is present.

## After `fit_match`
- `match` / `accessory` — recap using the API `why` and the returned `best_fit_product_id` name. Then lead capture.
- `honest_no` — decline, no kit. Then lead capture.
- `lead` — team desk, no boxed SKU. Then lead capture.
- `need_more` — ask only the missing signal the API named. Do not guess City vs core.

## Do not
- Pick Medium / Large from shoe size (size system is unlabeled; bands overlap).
- Run a quiz longer than three questions.
- Call `fit_explain` / `fit_compare` until the parent asks why / what’s the difference.
