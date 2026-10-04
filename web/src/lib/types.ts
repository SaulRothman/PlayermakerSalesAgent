export type Variant = {
  variant_id: number;
  title: string;
  sku: string | null;
  price: string;
  currency: string;
  available: boolean | null;
  options: Record<string, string>;
};

export type Media = {
  url: string;
  alt: string | null;
  width?: number;
  height?: number;
};

export type Product = {
  product_id: string;
  name: string;
  url: string;
  role: string;
  description: {
    short: string;
    full: string;
    what_it_does: string;
    outcomes: string[];
    features: string[];
    whats_included: string[];
    source_urls: string[];
  };
  variants: Variant[];
  fit: {
    supported_age_range: { min: number | null; max: number | null };
    size_shoe_bands: Array<{
      label: string;
      women: string | null;
      men: string | null;
      size_system: string | null;
      raw: string;
    }>;
    attaches_how: { summary: string };
    disturbs_play: { stated_effect: string };
    device_app_requirements: {
      phone_needed_during_session: boolean | null;
      bluetooth_required_for_sync: boolean | null;
      gps_required_to_record: boolean | null;
      wifi_required_to_record: boolean | null;
      app_names: string[];
      os_requirements: string | null;
      app_languages: string[];
    };
    battery: { session_limit_hours: number | null; capacity: string | null };
    stats_tracked: {
      technical: string[];
      physical: string[];
      skill_scores: string[];
      claimed_metric_count: number | null;
    };
  };
  media: Media[];
  membership: {
    included: string;
    renewal_price: string | null;
    renewal_currency: string | null;
    period: string | null;
    starts_when: string;
    without_plan: string;
  } | null;
  shipping_returns: { claims: string[] };
  gaps: string[];
};

export type CatalogProducts = {
  api_version: string;
  count: number;
  products: Product[];
  comparison: Array<Record<string, string | string[]>>;
};

export type CatalogProduct = {
  api_version: string;
  product: Product;
  relevant_gaps: Array<{
    gap_id: string;
    severity: string;
    field: string;
    detail: string;
  }>;
};

export type CatalogObjections = {
  api_version: string;
  count: number;
  objections: Array<{
    objection_id: string;
    objection: string;
    answer: string;
    source_urls: string[];
  }>;
};
