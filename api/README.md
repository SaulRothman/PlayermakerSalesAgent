# Playermaker catalog API (v1)

Single access path to scanned product data and fit math. Host: `http://localhost:3001`.

The website is a thin client and must **not** call this API from the browser. DevRev skills (Phase 6) will.

Nothing here invents prices, ages, sizes, or features. Unscanned facts come back as `gaps` / `need_more` / `honest_no`.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
PORT=3001 python -m uvicorn api.app:app --host 0.0.0.0 --port 3001
# Hosted: bind 0.0.0.0:$PORT (see ../render.yaml). Data dir defaults to data/playermaker.
```

From the repo root. Data dir defaults to `data/playermaker`. Override with `CATALOG_DATA_DIR`.

Optional auth (for the later DevRev keyring): set `CATALOG_API_KEY`. When set, send `X-API-Key` or `Authorization: Bearer <key>`. When unset, localhost is open.

OpenAPI: `http://localhost:3001/docs`

## Versioning

`api_version` is `1.0` on every JSON body. Routes exist at `/…` and `/v1/…`. Prefer `/v1` for new callers; unversioned paths stay for the skill drafts that will point at `http://localhost:3001`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/meta` | Scan timestamps, counts, product_ids |
| GET | `/products` | Full catalog (`?role=core_kit`) |
| GET | `/products/{product_id}` | One product + its gaps |
| POST | `/products` | Create product record |
| PATCH/PUT | `/products/{product_id}` | Edit product (`product_id` is immutable) |
| DELETE | `/products/{product_id}` | Remove product |
| POST | `/fit/match` | Buyer signals → best-fit / honest-no / lead / need_more |
| POST | `/fit/explain` | Why a `product_id` does or does not fit |
| POST | `/fit/compare` | Grounded deltas; optional live recommendation |
| GET | `/fit/rules` | Scanned rules |
| POST/PATCH/DELETE | `/fit/rules`… | Edit rules |
| GET | `/objections` | Q&A (`?q=` search) |
| GET/POST/PATCH/DELETE | `/objections`… | Read / edit objections |
| GET | `/gaps` | Missing + conflicting facts |
| POST | `/leads` | Profile + email → local store and, if `DEVREV_PAT` is set, DevRev pipeline |
| GET | `/leads` | Captured leads (PII — localhost / API key only) |
| PATCH | `/gaps/{gap_id}` | `status` / `editor_note` only — does not invent a resolution |
| POST | `/scan/refresh` | Re-run Phase 1 crawl (202) or `{ "reload_only": true }` |
| GET | `/scan/status` | Crawl job state |

## Fit contract

`POST /fit/match`

```json
{ "signals": { "age": 12, "wants_man_city_content": false } }
```

Signals (all optional; missing signals do **not** fire a rule):

- `age` (int)
- `wants_man_city_content` (bool)
- `already_owns_kit` (bool)
- `needs` (`extra_straps` / `colored_straps` / `replacement_straps`)
- `buyer_type` (`team_or_club` …)
- `position` (`goalkeeper` …)
- `environment` (`indoor`, `futsal`, …)
- `shoe_size` / `shoe_size_system` — recorded, never used to pick Medium/Large (size system is a known gap)

Outcomes: `match` | `accessory` | `honest_no` | `lead` | `need_more`.

Under 8 is `honest_no`. Age 8+ without a Man City yes/no is `need_more` with both kits as alternatives. Shoe size never selects a variant.

## Leads (Phase 4 / skill 223)

`POST /v1/leads`

```json
{
  "session_id": "s-1",
  "parent_name": "Alex Parent",
  "email": "alex@example.com",
  "outcome": "honest_no",
  "product_id": null,
  "why": "Under 8 is outside the stated range.",
  "signals": { "age": 7 },
  "utm": {},
  "source": "help-me-decide"
}
```

Always persisted to `data/playermaker/leads.json` (gitignored). When `DEVREV_PAT` is set on the API process, also creates a DevRev account + `rev-users` contact. Set `DEVREV_PART_ID` to also open a ticket. Set `DEVREV_REV_ORG` to attach the contact to an existing workspace instead of creating an account.

Phase 6 prerequisite: DevRev cloud cannot call `http://localhost:3001`. Host or tunnel this API to a public HTTPS URL before pointing skills 220–223 at it.

## Tests

```bash
.venv/bin/python -m pytest api/tests -q
```
