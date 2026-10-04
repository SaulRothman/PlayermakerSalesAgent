import "server-only";

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

import type { CatalogObjections, CatalogProduct, CatalogProducts, Product } from "./types";

export class CatalogUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogUnavailable";
  }
}

function baseUrl(): string {
  return (process.env.CATALOG_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

function headers(): Record<string, string> {
  const key = process.env.CATALOG_API_KEY;
  const h: Record<string, string> = { Accept: "application/json" };
  if (key) h["X-API-Key"] = key;
  return h;
}

function catalogRequest<T>(path: string, method: "GET" | "POST", payload?: unknown): Promise<T> {
  const url = new URL(`${baseUrl()}${path}`);
  const lib = url.protocol === "https:" ? https : http;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const hdrs = headers();
  if (body) hdrs["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? "443" : "80"),
        path: `${url.pathname}${url.search}`,
        method,
        headers: hdrs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          if (status >= 400) {
            reject(new CatalogUnavailable(`Catalog API ${status} for ${path}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new CatalogUnavailable(`Catalog API returned non-JSON for ${path}`));
          }
        });
      },
    );
    req.on("error", (err) => {
      reject(new CatalogUnavailable(`Catalog API unreachable: ${err.message}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function catalogGet<T>(path: string): Promise<T> {
  return catalogRequest<T>(path, "GET");
}

export async function fetchProducts(): Promise<CatalogProducts> {
  return catalogGet<CatalogProducts>("/v1/products");
}

export async function fetchProduct(productId: string): Promise<CatalogProduct> {
  return catalogGet<CatalogProduct>(`/v1/products/${encodeURIComponent(productId)}`);
}

export async function fetchObjections(): Promise<CatalogObjections> {
  return catalogGet<CatalogObjections>("/v1/objections");
}

export async function fetchFitMatch(signals: Record<string, unknown>): Promise<Record<string, unknown>> {
  return catalogRequest<Record<string, unknown>>("/v1/fit/match", "POST", { signals });
}

export async function fetchCaptureLead(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return catalogRequest<Record<string, unknown>>("/v1/leads", "POST", payload);
}

export function firstPrice(product: Product): string {
  const v = product.variants[0];
  if (!v?.price) return "";
  const symbol = v.currency === "USD" ? "$" : `${v.currency} `;
  return `${symbol}${v.price.replace(/\.00$/, "")}`;
}

export function firstImage(product: Product): string | null {
  return product.media?.[0]?.url || null;
}
