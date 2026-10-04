# Playbook — skills

The website never calls the catalog. You do, through skills. Product facts come back on the skill output — put them on the panel, do not invent a second catalog in your mouth.

| Skill | Workflow | When |
|---|---|---|
| `fit_match` | 220 | After the honesty check, or as soon as you have enough signals for a terminal rule. Always before naming a best-fit kit. |
| `fit_explain` | 221 | Parent asks “why this one?” / “why not CITYPLAY?” Pass `product_id` + current signals. |
| `fit_compare` | 222 | Parent asks for a side-by-side. Do not compare SKUs that are not in the catalog. |
| `capture_lead` | 223 | After every terminal outcome (`match`, `accessory`, `honest_no`, `lead`) once you have parent name + email. Also when they refuse — you do not call 223. |

## `fit_match` body

```json
{ "signals": { "age": 12, "wants_man_city_content": false } }
```

Optional signals (only if the parent said them): `already_owns_kit`, `needs`, `buyer_type`, `position`, `environment`, `shoe_size`, `shoe_size_system`.

Missing signals do **not** fire a rule. Do not fill them in.

## After a skill
Render:
- `messages` — your script, grounded in `why`
- `chips` — next tap targets from `scripts/chips.md`
- `panel` — products from the skill/catalog output; emphasize `best_fit_product_id`
- `lead_form` — when the playbook says to offer a lead

## Phase 6 wiring
HTTP target is a **public HTTPS** catalog URL. Not `http://localhost:3001`.
