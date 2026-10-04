# Phase 1 scan schema

Re-run: `python3 scripts/scan_playermaker.py`

All values are copied or extracted from fetched Playermaker pages / Shopify JSON.
Missing or conflicting facts are listed in `gaps.json`, never invented.

## `products.json`

```
{
  schema_version, generated_at, source,
  comparison: [                        # grounded deltas between the two kits + accessory
    { topic, playermaker-2.0, cityplay, extra-straps, source_urls[] }
  ],
  products: [
    {
      product_id,                      # stable slug: playermaker-2.0 | cityplay | extra-straps
      shopify_product_id, handle, name, url, vendor, role,
      description: { short, full, what_it_does, outcomes[], features[], whats_included[], source_urls[] },
      variants: [
        { variant_id, title, sku, barcode, price, currency, available,
          options{}, weight_grams, image_url }
      ],
      fit: {
        supported_age_range: { min, max, raw_statements[], source_urls[] },
        size_shoe_bands: [{ label, women, men, size_system, raw, source_url }],
        attaches_how: { summary, source_urls[] },
        disturbs_play: { stated_effect, raw_statements[], source_urls[] },
        device_app_requirements: { ... },
        battery: { session_limit_hours, capacity, raw_statements[], source_urls[] },
        stats_tracked: { technical[], physical[], skill_scores[], claimed_metric_count }
      },
      media: [{ url, alt, width, height, variant_ids[] }],
      membership: { included, renewal_price, renewal_currency, period, starts_when, source_urls[] },
      shipping_returns: { claims[], source_urls[] },
      gaps: [gap_id]
    }
  ]
}
```

`product_id` is derived from the Shopify handle and is stable across re-scans.
Shopify numeric IDs are stored separately and may change if the merchant recreates a product.

## `fit_rules.json`

```
{
  schema_version, generated_at,
  rules: [
    {
      rule_id,
      priority,                        # lower = evaluated first
      signals: { ... buyer attributes ... },
      best_fit_product_id,             # product_id or null
      outcome,                         # match | accessory | honest_no | lead
      why,                             # human sentence grounded in scan text
      source_urls[]
    }
  ]
}
```

Rules are generated only from extracted facts (age floor, CITYPLAY extras, accessory role, team SKU absence).

## `objections.json`

```
{
  schema_version, generated_at,
  objections: [
    { objection_id, objection, answer, source_urls[] }
  ]
}
```

Each answer is taken from on-page Q&A / comparison copy. No paraphrase that adds facts.

## `source_pages.json`

```
{
  schema_version, generated_at,
  robots: { url, fetched_at, sitemaps[] },
  pages: [
    { url, fetched_at, status, content_type, title, kind, bytes, text_chars, notes[] }
  ]
}
```

## `gaps.json`

```
{
  schema_version, generated_at,
  gaps: [
    { gap_id, severity, field, product_id?, detail, source_urls[] }
  ]
}
```

Severity: `missing` | `conflict` | `thin_page` | `unparsed`.
