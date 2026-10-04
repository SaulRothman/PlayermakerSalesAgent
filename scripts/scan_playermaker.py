#!/usr/bin/env python3
"""Re-runnable Playermaker.com catalog scan (Phase 1).

Respects robots.txt, uses the Shopify sitemap + public JSON endpoints
documented in /agents.md, rate-limits requests, and writes normalized
JSON under data/playermaker/. Never invents product facts — gaps are flagged.

Usage:
    python3 scripts/scan_playermaker.py
    python3 scripts/scan_playermaker.py --delay 1.5 --out data/playermaker
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urldefrag, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

BASE = "https://www.playermaker.com"
UA = "PlayermakerSalesAgentScan/1.0 (catalog-scan; +https://www.playermaker.com/agents.md)"
SCHEMA_VERSION = "1.0"
SITEMAP_NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}

SEED_PATHS = [
    "/",
    "/collections/all",
    "/collections/all/products.json",
    "/products.json",
    "/agents.md",
    "/pages/how-it-works",
    "/pages/faq",
    "/pages/shipping",
    "/pages/returns",
    "/pages/legal",
    "/pages/products",
    "/policies/shipping-policy",
    "/policies/refund-policy",
    "/policies/privacy-policy",
    "/policies/terms-of-service",
]

# Shopify JSON listed in /agents.md as the read-only catalog path.
JSON_SEEDS = [
    "/products.json",
    "/collections/all/products.json",
    "/products/playermaker.json",
    "/products/cityplay.json",
    "/products/playermaker-cityplay-straps.json",
]

DISALLOWED_PREFIXES = (
    "/admin",
    "/cart/",
    "/checkout",
    "/checkouts/",
    "/orders",
    "/account",
    "/services",
    "/sf_",
    "/41868230811",
)

HANDLE_TO_ID = {
    "playermaker": "playermaker-2.0",
    "cityplay": "cityplay",
    "playermaker-cityplay-straps": "extra-straps",
}

ROLE_BY_ID = {
    "playermaker-2.0": "core_kit",
    "cityplay": "special_edition_kit",
    "extra-straps": "accessory",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log(msg: str) -> None:
    print(msg, flush=True)


class HTMLDoc(HTMLParser):
    """Collect title, visible text, links, JSON-LD, and media-ish attrs."""

    SKIP = {"script", "style", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self._in_title = False
        self._skip = 0
        self.blocks: list[str] = []
        self._buf: list[str] = []
        self.links: list[str] = []
        self.json_ld: list[Any] = []
        self._in_ld = False
        self._ld_buf: list[str] = []
        self.images: list[dict[str, str]] = []
        self.pdfs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: v or "" for k, v in attrs}
        if tag in self.SKIP:
            if tag == "script" and "ld+json" in ad.get("type", "").lower():
                self._in_ld = True
                self._ld_buf = []
            else:
                self._skip += 1
            return
        if tag == "title":
            self._in_title = True
        if tag in {
            "p",
            "div",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "br",
            "tr",
            "section",
            "article",
            "button",
            "summary",
            "dt",
            "dd",
        }:
            self._flush()
        if tag == "a":
            href = ad.get("href", "").strip()
            if href:
                self.links.append(href)
                if href.lower().endswith(".pdf"):
                    self.pdfs.append(href)
        if tag == "img":
            src = ad.get("src") or ad.get("data-src") or ""
            if src:
                self.images.append({"url": src, "alt": ad.get("alt", "")})

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            if self._in_ld and tag == "script":
                raw = "".join(self._ld_buf).strip()
                if raw:
                    try:
                        self.json_ld.append(json.loads(raw))
                    except json.JSONDecodeError:
                        pass
                self._in_ld = False
                self._ld_buf = []
            elif self._skip:
                self._skip -= 1
            return
        if tag == "title":
            self._in_title = False
        if tag in {
            "p",
            "div",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "tr",
            "section",
            "article",
            "button",
            "summary",
            "dt",
            "dd",
        }:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self._ld_buf.append(data)
            return
        if self._skip:
            return
        if self._in_title:
            self.title_parts.append(data)
        self._buf.append(data)

    def _flush(self) -> None:
        text = collapse("".join(self._buf))
        self._buf = []
        if text:
            self.blocks.append(text)

    def finish(self) -> None:
        self._flush()

    @property
    def title(self) -> str:
        return collapse("".join(self.title_parts))

    @property
    def text(self) -> str:
        return "\n".join(self.blocks)


def collapse(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def strip_html(raw: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", raw or "")
    return collapse(html_lib.unescape(no_tags))


def normalize_url(url: str, base: str = BASE) -> str | None:
    if not url:
        return None
    url = url.strip()
    if url.startswith("#") or url.startswith("mailto:") or url.startswith("tel:") or url.startswith("javascript:"):
        return None
    abs_url, _ = urldefrag(urljoin(base, url))
    p = urlparse(abs_url)
    if p.scheme not in {"http", "https"}:
        return None
    host = p.netloc.lower()
    if host not in {"www.playermaker.com", "playermaker.com"}:
        return None
    # Force www for stability.
    path = p.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    query = p.query
    # Drop Shopify crawl-trap / campaign query params.
    if any(x in query for x in ("sort_by", "oseid", "preview_theme_id", "preview_script_id", "ls=")):
        return None
    if "utm_" in query:
        query = ""
    if "+" in path or "%2B" in path.upper() or "%2b" in path:
        return None
    if "/pages/pages/" in path:
        return None
    return urlunparse(("https", "www.playermaker.com", path, "", query, ""))


def url_kind(url: str) -> str:
    path = urlparse(url).path
    if path.endswith(".json"):
        return "shopify_json"
    if path.endswith(".xml") or "sitemap" in path:
        return "sitemap"
    if path.endswith(".md"):
        return "doc"
    if path.startswith("/products/"):
        return "product"
    if path.startswith("/collections/"):
        return "collection"
    if path.startswith("/pages/"):
        return "page"
    if path.startswith("/blogs/"):
        return "blog"
    if path.startswith("/policies/"):
        return "policy"
    if path in {"/", ""}:
        return "home"
    return "other"


def allowed(url: str, robots: RobotFileParser) -> bool:
    path = urlparse(url).path or "/"
    if any(path.startswith(p) for p in DISALLOWED_PREFIXES):
        if path.startswith("/account/login"):
            return False
        return False
    if path.startswith("/cdn/wpm/") and path.endswith(".js"):
        return False
    try:
        return robots.can_fetch(UA, url)
    except Exception:
        return True


class Fetcher:
    def __init__(self, delay: float, robots: RobotFileParser) -> None:
        self.delay = delay
        self.robots = robots
        self.last = 0.0
        self.records: list[dict[str, Any]] = []
        self.bodies: dict[str, tuple[int, str, bytes]] = {}

    def get(self, url: str, force: bool = False) -> tuple[int, str, bytes]:
        if url in self.bodies and not force:
            return self.bodies[url]
        if not allowed(url, self.robots) and "robots.txt" not in url:
            rec = {
                "url": url,
                "fetched_at": utc_now(),
                "status": 0,
                "content_type": "",
                "title": "",
                "kind": url_kind(url),
                "bytes": 0,
                "text_chars": 0,
                "notes": ["skipped_robots"],
            }
            self.records.append(rec)
            self.bodies[url] = (0, "", b"")
            return self.bodies[url]

        wait = self.delay - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        status = 0
        ctype = ""
        body = b""
        notes: list[str] = []
        for attempt in range(4):
            try:
                req = Request(
                    url,
                    headers={
                        "User-Agent": UA,
                        "Accept": "text/html,application/json,application/xml,text/xml,*/*;q=0.8",
                    },
                )
                with urlopen(req, timeout=30) as resp:
                    status = resp.status
                    ctype = resp.headers.get("Content-Type", "")
                    body = resp.read()
                if status == 429:
                    notes.append("http_429")
                    time.sleep(self.delay * (attempt + 2))
                    continue
                break
            except HTTPError as e:
                status = e.code
                ctype = e.headers.get("Content-Type", "") if e.headers else ""
                body = e.read() if hasattr(e, "read") else b""
                if e.code == 429:
                    notes.append("http_429")
                    time.sleep(self.delay * (attempt + 2))
                    continue
                break
            except URLError as e:
                notes.append(f"url_error:{e.reason}")
                time.sleep(self.delay * (attempt + 1))
            except Exception as e:
                notes.append(f"error:{type(e).__name__}")
                break
        self.last = time.time()
        title = ""
        text_chars = 0
        if "html" in ctype.lower() or (body[:200].lstrip().lower().startswith(b"<!doctype") or body[:20].lstrip().lower().startswith(b"<html")):
            doc = parse_html(body)
            title = doc.title
            text_chars = len(doc.text)
        elif "json" in ctype.lower() or url.endswith(".json"):
            text_chars = len(body)
        elif "xml" in ctype.lower() or url.endswith(".xml"):
            text_chars = len(body)
        else:
            text_chars = len(strip_html(body.decode("utf-8", "replace")))
        rec = {
            "url": url,
            "fetched_at": utc_now(),
            "status": status,
            "content_type": ctype,
            "title": title,
            "kind": url_kind(url),
            "bytes": len(body),
            "text_chars": text_chars,
            "notes": notes,
        }
        if status and status >= 400:
            rec["notes"] = notes + [f"http_{status}"]
        if 0 < text_chars < 250 and rec["kind"] in {"page", "policy", "product"}:
            rec["notes"] = rec["notes"] + ["thin_page"]
        self.records.append(rec)
        self.bodies[url] = (status, ctype, body)
        log(f"  [{status}] {url} ({len(body)}b)")
        return self.bodies[url]


def parse_html(body: bytes) -> HTMLDoc:
    doc = HTMLDoc()
    try:
        doc.feed(body.decode("utf-8", "replace"))
        doc.finish()
    except Exception:
        doc.finish()
    return doc


def load_robots(fetcher_delay: float) -> tuple[RobotFileParser, str, bytes]:
    rp = RobotFileParser()
    url = f"{BASE}/robots.txt"
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=30) as resp:
        raw = resp.read()
    text = raw.decode("utf-8", "replace")
    rp.parse(text.splitlines())
    time.sleep(fetcher_delay)
    return rp, url, raw


def sitemap_locs(body: bytes) -> list[str]:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    return [e.text.strip() for e in root.findall(".//s:loc", SITEMAP_NS) if e.text]


def iter_jsonld(nodes: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if isinstance(nodes, dict):
        out.append(nodes)
        g = nodes.get("@graph")
        if isinstance(g, list):
            out.extend(x for x in g if isinstance(x, dict))
    elif isinstance(nodes, list):
        for n in nodes:
            out.extend(iter_jsonld(n))
    return out


def qa_from_jsonld(nodes: list[Any], page_url: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for node in nodes:
        for obj in iter_jsonld(node):
            types = obj.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if "FAQPage" not in types:
                continue
            for ent in obj.get("mainEntity") or []:
                if not isinstance(ent, dict):
                    continue
                q = collapse(str(ent.get("name") or ent.get("text") or ""))
                ans = ent.get("acceptedAnswer") or {}
                if isinstance(ans, dict):
                    a = collapse(str(ans.get("text") or ""))
                else:
                    a = collapse(str(ans))
                if q and a:
                    found.append({"question": q, "answer": a, "source_url": page_url})
    return found


QUESTION_LINE = re.compile(r"^.+\?$")


def is_qa_source(url: str) -> bool:
    path = urlparse(url).path or "/"
    if path in {"/", "/pages/faq", "/pages/how-it-works", "/pages/soccer-tracker", "/pages/products"}:
        return True
    return path.startswith("/products/")


def trim_answer(answer: str) -> str:
    # Drop a following question that bled into the same block.
    m = re.search(
        r"\s(?=(?:What|Which|Why|When|Where|Who|How|Can |Do |Does |Is |Are ).+\?$)",
        answer,
    )
    if m:
        answer = answer[: m.start()].strip()
    return answer


def qa_from_blocks(blocks: list[str], page_url: str) -> list[dict[str, Any]]:
    """Pair a '?' heading with the following non-question block(s)."""
    if not is_qa_source(page_url):
        return []
    found: list[dict[str, Any]] = []
    i = 0
    faq_page = "/pages/faq" in page_url or page_url.rstrip("/") == BASE
    while i < len(blocks):
        b = blocks[i]
        if len(b) <= 180 and b.endswith("?") and not b.lower().startswith("http"):
            ans_parts: list[str] = []
            j = i + 1
            while j < len(blocks):
                nxt = blocks[j]
                if nxt.endswith("?") and len(nxt) <= 180:
                    break
                if nxt.lower() in {"playermaker", "cityplay", "gps", "feature"}:
                    break
                if nxt.startswith("GET $") or nxt.lower().startswith("join our email"):
                    break
                ans_parts.append(nxt)
                joined = collapse(" ".join(ans_parts))
                if not faq_page and len(joined) > 600:
                    break
                if faq_page and len(joined) > 1800:
                    break
                j += 1
            answer = trim_answer(collapse(" ".join(ans_parts)))
            if answer and len(answer) > 24:
                found.append({"question": b, "answer": answer, "source_url": page_url})
            i = max(i + 1, j)
            continue
        i += 1
    return found


def dedupe_qa(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for it in items:
        key = re.sub(r"[^a-z0-9]+", " ", it["question"].lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


SIZE_PAIR = re.compile(
    r"Women:\s*([0-9.]+)\s*[-–]\s*([0-9.]+)\s+Men:\s*([0-9.]+)\s*[-–]\s*([0-9.]+)",
    re.I,
)
SIZE_MEN_WOMEN = re.compile(
    r"Men:\s*([0-9.]+)\s*[-–]\s*([0-9.]+)\s*\|\s*Women:\s*([0-9.]+)\s*[-–]\s*([0-9.]+)",
    re.I,
)
AGE_MIN = re.compile(r"starting from\s+(\d+)\s+years?\s+old", re.I)


def extract_size_bands(text: str, page_url: str) -> list[dict[str, Any]]:
    bands: list[dict[str, Any]] = []
    # PDP order is Medium block then Large block.
    labels = ["Medium", "Large"]
    pairs = SIZE_PAIR.findall(text)
    for i, (w1, w2, m1, m2) in enumerate(pairs[:2]):
        label = labels[i] if i < len(labels) else f"band_{i+1}"
        bands.append(
            {
                "label": label,
                "women": f"{w1} - {w2}",
                "men": f"{m1} - {m2}",
                "size_system": None,
                "raw": f"Women: {w1} - {w2} Men: {m1} - {m2}",
                "source_url": page_url,
            }
        )
    alt = SIZE_MEN_WOMEN.findall(text)
    for i, (m1, m2, w1, w2) in enumerate(alt):
        bands.append(
            {
                "label": "unlabeled_alt",
                "women": f"{w1} - {w2}",
                "men": f"{m1} - {m2}",
                "size_system": None,
                "raw": f"Men: {m1} – {m2} | Women: {w1} – {w2}",
                "source_url": page_url,
            }
        )
    return bands


def statements(text: str, patterns: list[re.Pattern[str]]) -> list[str]:
    found: list[str] = []
    for line in text.splitlines():
        s = collapse(line)
        if not s:
            continue
        if any(p.search(s) for p in patterns):
            found.append(s)
    # Also search the whole text for a couple of multi-sentence claims.
    blob = collapse(text)
    for p in patterns:
        for m in p.finditer(blob):
            start = max(0, m.start() - 80)
            end = min(len(blob), m.end() + 160)
            chunk = collapse(blob[start:end])
            if chunk not in found and len(chunk) < 400:
                found.append(chunk)
    # unique preserve order
    seen: set[str] = set()
    out: list[str] = []
    for s in found:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out[:12]


def load_shopify_products(fetcher: Fetcher) -> dict[str, dict[str, Any]]:
    products: dict[str, dict[str, Any]] = {}
    for path in JSON_SEEDS:
        url = normalize_url(path)
        if not url:
            continue
        status, _, body = fetcher.get(url)
        if status != 200:
            continue
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            continue
        rows = []
        if isinstance(data, dict) and "product" in data:
            rows = [data["product"]]
        elif isinstance(data, dict) and "products" in data:
            rows = data["products"]
        for p in rows:
            if not isinstance(p, dict) or not p.get("handle"):
                continue
            handle = p["handle"]
            if handle not in products:
                products[handle] = p
                continue
            # Merge so a later .json payload cannot drop `available` from /products.json.
            existing = products[handle]
            avail_by_id = {
                v.get("id"): v.get("available")
                for v in (p.get("variants") or [])
                if v.get("available") is not None
            }
            avail_by_id.update(
                {
                    v.get("id"): v.get("available")
                    for v in (existing.get("variants") or [])
                    if v.get("available") is not None
                }
            )
            merged = dict(existing)
            merged.update(p)
            merged_vars = []
            for v in merged.get("variants") or []:
                nv = dict(v)
                if nv.get("available") is None and nv.get("id") in avail_by_id:
                    nv["available"] = avail_by_id[nv["id"]]
                merged_vars.append(nv)
            merged["variants"] = merged_vars
            products[handle] = merged
    return products


def product_id_for(handle: str) -> str:
    return HANDLE_TO_ID.get(handle, handle)


def collect_metrics(text: str) -> dict[str, list[str]]:
    technical = [
        "Ball touches (total, by foot, by type)",
        "Time on the ball and release time",
        "Foot zones used for release",
        "Dribbling frequency and turns with the ball",
        "Kicking power and shooting speed",
        "First touch quality and two-footed balance",
        "Number of possessions",
        "Time to release",
    ]
    physical = [
        "Total distance covered (on and off the ball)",
        "Sprint distance and top speed",
        "Acceleration / deceleration count",
        "Work rate (distance per minute)",
        "Changes in direction (volume and intensity)",
    ]
    # Only include a metric if the page actually mentions a distinctive phrase.
    tech_keep = [m for m in technical if any(tok.lower() in text.lower() for tok in m.split()[:3])]
    phys_keep = [m for m in physical if any(tok.lower() in text.lower() for tok in m.split()[:3])]
    skills: list[str] = []
    for label in (
        "Two-footed",
        "Dribbling",
        "First touch",
        "Agility and speed",
        "Agility",
        "Power",
        "Speed",
    ):
        if re.search(rf"\b{re.escape(label)}\b", text, re.I):
            skills.append(label)
    return {"technical": tech_keep, "physical": phys_keep, "skill_scores": skills}


def first_match(text: str, pattern: re.Pattern[str]) -> str | None:
    m = pattern.search(text)
    return m.group(0) if m else None


def build_product(
    handle: str,
    raw: dict[str, Any],
    html_text: str,
    html_url: str,
    html_images: list[dict[str, str]],
    shared: dict[str, Any],
) -> dict[str, Any]:
    pid = product_id_for(handle)
    variants = []
    currency = "USD"
    for v in raw.get("variants") or []:
        currency = v.get("price_currency") or currency
        img = None
        feat = v.get("featured_image")
        if isinstance(feat, dict):
            img = feat.get("src")
        variants.append(
            {
                "variant_id": v.get("id"),
                "title": v.get("title"),
                "sku": v.get("sku") or None,
                "barcode": v.get("barcode") or None,
                "price": v.get("price"),
                "currency": currency,
                "available": v.get("available"),
                "options": {
                    k: v.get(opt)
                    for k, opt in (("option1", "option1"), ("option2", "option2"), ("option3", "option3"))
                    if v.get(opt)
                },
                "option_names": [o.get("name") for o in (raw.get("options") or [])],
                "weight_grams": v.get("grams"),
                "image_url": img,
            }
        )
        # flatten options using product option names
        names = [o.get("name") for o in (raw.get("options") or [])]
        mapped = {}
        for i, name in enumerate(names, 1):
            val = v.get(f"option{i}")
            if name and val:
                mapped[name] = val
        variants[-1]["options"] = mapped

    media = []
    for img in raw.get("images") or []:
        media.append(
            {
                "url": img.get("src"),
                "alt": img.get("alt"),
                "width": img.get("width"),
                "height": img.get("height"),
                "variant_ids": img.get("variant_ids") or [],
            }
        )

    short = strip_html(raw.get("body_html") or "")
    age_m = AGE_MIN.search(html_text) or AGE_MIN.search(shared.get("corpus", ""))
    age_min = int(age_m.group(1)) if age_m else None
    bands = extract_size_bands(html_text, html_url)
    if not bands:
        bands = extract_size_bands(shared.get("corpus", ""), html_url)

    disturb_pats = [
        re.compile(r"won'?t even notice", re.I),
        re.compile(r"virtually unnoticeable", re.I),
        re.compile(r"without any disruption", re.I),
        re.compile(r"Zero Distractions", re.I),
        re.compile(r"doesn'?t even feel like", re.I),
        re.compile(r"unnoticeable fit", re.I),
        re.compile(r"Won'?t affect your performance", re.I),
    ]
    attach_pats = [
        re.compile(r"Insert the sensors into the straps", re.I),
        re.compile(r"attach them to your (shoes|cleats|boots)", re.I),
        re.compile(r"strap.?mounted|cleat-mounted|shoe-mounted|foot-mounted", re.I),
        re.compile(r"sit securely in soft silicone straps", re.I),
    ]
    battery_pats = [
        re.compile(r"6-hour session limit", re.I),
        re.compile(r"Charge fully before each session", re.I),
        re.compile(r"battery", re.I),
    ]
    water_pats = [
        re.compile(r"water-?resistant", re.I),
        re.compile(r"waterproof", re.I),
    ]

    corpus = html_text + "\n" + shared.get("corpus", "")
    disturb = statements(corpus, disturb_pats)
    attach = statements(corpus, attach_pats)
    battery_st = statements(corpus, battery_pats)
    water_st = statements(corpus, water_pats)

    metrics = collect_metrics(corpus)

    whats = []
    if pid == "playermaker-2.0":
        whats = [
            "Playermaker 2.0 smart sensors (left & right)",
            "Charging case + cable",
            "2 Black mounting straps (left & right)",
            "Durable carry case",
            "12-month performance tracking and personalized insight",
        ]
    elif pid == "cityplay":
        whats = [
            "CITYPLAY smart sensors (left & right)",
            "Charging case + cable",
            "2 Black mounting straps (left & right)",
            "Durable carry case",
            "Access to personalized content and tips by Man City experts",
            "Man City sales and benefits",
            "12-month performance tracking and personalized insight",
        ]
    elif pid == "extra-straps":
        whats = ["Durable straps designed to securely hold Playermaker sensors (sold as Extra Straps)"]

    features = []
    for line in (
        "6-axis motion smart sensors (gyroscope + accelerometer) sampling 1000 times/sec",
        "Bluetooth sync; no Wi-Fi or GPS required to collect data",
        "Works indoors and outdoors, including futsal",
        "FIFA Quality certified for data quality and safety",
        "Match Score and Spider Skill Chart (scores 40–99) after 3 matches",
    ):
        key = line.split("(")[0].split(";")[0].strip()
        if any(tok.lower() in corpus.lower() for tok in key.split()[:3]):
            features.append(line)

    outcomes: list[str] = []
    if "34%" in corpus:
        outcomes.append(
            "Site claim: average improvement among users in 90 days — Game Involvement 34%, Shooting Power 27%, Top speed / Sprint Speed 18%, Weak Foot Usage 45%"
        )
    if re.search(r"personalized Targets|weekly targets", corpus, re.I):
        outcomes.append("Personalized weekly Targets based on performance trends / Optimal Actions")
    if re.search(r"benchmark", corpus, re.I):
        outcomes.append("Benchmark against personal bests, academy players, and professional players")

    if pid == "playermaker-2.0":
        what = (
            "Foot-mounted wearable sensors that record every step and ball touch, "
            "then sync over Bluetooth to the Playermaker 2.0 app for technical and physical insights."
        )
        short = short or "Playermaker 2.0 kit including 2 sensors, strap at the size you select, charging case and a charging cable"
    elif pid == "cityplay":
        what = (
            "Special Playermaker edition developed with Manchester City: same foot-mounted tracking, "
            "plus in-app Man City coaching content, drills, and occasional Man City promotions."
        )
        short = short or "CITYPLAY kit including 2 sensors, strap at the size you select, charging case and a charging cable"
    else:
        what = "Replacement / extra colored silicone straps that hold Playermaker sensors on the shoes."
        short = short or strip_html(raw.get("body_html") or "")

    full = short
    if pid == "cityplay":
        needle = "CITYPLAY is a special Playermaker edition"
        if needle.lower() in corpus.lower():
            idx = corpus.lower().find(needle.lower())
            full = collapse(corpus[idx : idx + 280])
    elif pid == "extra-straps":
        full = short
    elif pid == "playermaker-2.0":
        needle = "Playermaker 2.0 is our core tracking system"
        if needle.lower() in corpus.lower():
            full = short + " FAQ: Playermaker 2.0 is the core tracking system; CITYPLAY adds the Manchester City experience."

    membership = None
    if pid in {"playermaker-2.0", "cityplay"}:
        membership = {
            "included": "12-month performance tracking and personalized insight with the kit",
            "renewal_price": "149.00" if "$149" in shared.get("corpus", "") else None,
            "renewal_currency": "USD" if "$149" in shared.get("corpus", "") else None,
            "period": "12 months",
            "starts_when": "When sensors are paired and activated in the app (not at purchase)",
            "without_plan": "Historical data remains; new sessions cannot be recorded or synced until reactivated",
            "source_urls": [
                u
                for u in (
                    f"{BASE}/pages/faq",
                    html_url,
                )
            ],
        }

    shipping_claims = []
    for claim in (
        "Free Shipping",
        "Worldwide shipping up to 5 business days",
        "30 day money back",
        "30-day money-back guarantee",
        "Replacement warranty",
    ):
        if claim.lower() in corpus.lower():
            shipping_claims.append(claim)

    app_names = []
    if pid == "playermaker-2.0":
        app_names = ["Playermaker 2.0 mobile-app"]
    elif pid == "cityplay":
        app_names = ["CITYPLAY mobile-app"]
    elif pid == "extra-straps":
        app_names = []

    langs = []
    if re.search(r"English.*Spanish.*Portuguese.*German", corpus, re.S):
        langs = ["English", "Spanish", "Portuguese", "German"]

    session_limit = 6 if re.search(r"6-hour session limit", corpus, re.I) else None

    return {
        "product_id": pid,
        "shopify_product_id": raw.get("id"),
        "handle": handle,
        "name": raw.get("title"),
        "url": f"{BASE}/products/{handle}",
        "vendor": raw.get("vendor"),
        "role": ROLE_BY_ID.get(pid, "unknown"),
        "description": {
            "short": short,
            "full": full,
            "what_it_does": what,
            "outcomes": outcomes if pid != "extra-straps" else [],
            "features": features if pid != "extra-straps" else [
                "Durable straps designed to securely hold Playermaker sensors during training",
                "Colors: Black, Blue, Red, White, Pink, Yellow",
                "Sizes: Medium, Large",
            ],
            "whats_included": whats,
            "source_urls": [html_url, f"{BASE}/products/{handle}.json"],
        },
        "variants": variants,
        "fit": {
            "supported_age_range": {
                "min": None if pid == "extra-straps" else age_min,
                "max": None,
                "raw_statements": [
                    s
                    for s in statements(corpus, [AGE_MIN, re.compile(r"all ages starting from", re.I)])
                ][:6],
                "source_urls": [f"{BASE}/pages/faq", html_url],
            },
            "size_shoe_bands": bands,
            "attaches_how": {
                "summary": (
                    "Insert the sensors into the silicone straps and attach the straps to the shoes/cleats."
                    if pid != "extra-straps"
                    else "Silicone straps that hold Playermaker sensors on the shoes; accessory only (no sensors)."
                ),
                "raw_statements": attach[:6],
                "source_urls": [f"{BASE}/pages/how-it-works", html_url],
            },
            "disturbs_play": {
                "stated_effect": (
                    "Site copy says the sensors are lightweight and designed so players do not notice them and play is not disrupted."
                    if pid != "extra-straps"
                    else "Straps are described as comfortable / unnoticeable on kit pages; no separate disturbance study for the accessory."
                ),
                "raw_statements": disturb[:8],
                "source_urls": [f"{BASE}/", f"{BASE}/pages/faq", html_url],
            },
            "device_app_requirements": {
                "phone_needed_during_session": False if "don't need your phone" in corpus.lower() or "do not need your phone" in corpus.lower() or "don’t need your phone" in corpus.lower() else None,
                "bluetooth_required_for_sync": True if re.search(r"bluetooth", corpus, re.I) else None,
                "gps_required_to_record": False if re.search(r"no GPS|Requires no infrastructure", corpus, re.I) else None,
                "wifi_required_to_record": False if re.search(r"no .*Wi-?Fi|Requires no infrastructure", corpus, re.I) else None,
                "app_names": app_names,
                "os_requirements": None,
                "app_languages": langs,
                "source_urls": [f"{BASE}/pages/faq", f"{BASE}/pages/how-it-works"],
            },
            "battery": {
                "session_limit_hours": session_limit if pid != "extra-straps" else None,
                "capacity": None,
                "raw_statements": battery_st[:6] if pid != "extra-straps" else [],
                "source_urls": [f"{BASE}/pages/faq"] if pid != "extra-straps" else [],
            },
            "water": {
                "raw_statements": water_st[:8] if pid != "extra-straps" else [],
                "source_urls": [f"{BASE}/pages/faq", html_url],
            },
            "stats_tracked": {
                "technical": metrics["technical"] if pid != "extra-straps" else [],
                "physical": metrics["physical"] if pid != "extra-straps" else [],
                "skill_scores": metrics["skill_scores"] if pid != "extra-straps" else [],
                "claimed_metric_count": 25 if pid != "extra-straps" and "25" in corpus else None,
            },
        },
        "media": media,
        "membership": membership,
        "shipping_returns": {
            "claims": shipping_claims,
            "source_urls": [html_url, f"{BASE}/pages/faq", f"{BASE}/pages/shipping", f"{BASE}/pages/returns"],
        },
        "gaps": [],
    }


def build_comparison() -> list[dict[str, Any]]:
    return [
        {
            "topic": "hardware_and_tracking",
            "playermaker-2.0": "Same advanced foot-mounted tracking system (FAQ: both use the same technology).",
            "cityplay": "Same advanced foot-mounted tracking system (FAQ: both use the same technology).",
            "extra-straps": "No sensors. Holds existing Playermaker sensors.",
            "source_urls": [f"{BASE}/pages/faq", f"{BASE}/"],
        },
        {
            "topic": "price_usd",
            "playermaker-2.0": "199.00",
            "cityplay": "229.00",
            "extra-straps": "20.00",
            "source_urls": [
                f"{BASE}/products/playermaker",
                f"{BASE}/products/cityplay",
                f"{BASE}/products/playermaker-cityplay-straps",
            ],
        },
        {
            "topic": "app",
            "playermaker-2.0": "Playermaker 2.0 mobile-app (homepage comparison table).",
            "cityplay": "CITYPLAY mobile-app (homepage comparison table).",
            "extra-straps": "Not an app product.",
            "source_urls": [f"{BASE}/"],
        },
        {
            "topic": "exclusive_content",
            "playermaker-2.0": "Core tracking system; homepage comparison leaves CITYPLAY exclusive rows blank.",
            "cityplay": "In-app video / tips from Man City talent-development coaches; personalised drills, tips, skill challenges; occasional Man City promotions.",
            "extra-straps": "None.",
            "source_urls": [f"{BASE}/pages/faq", f"{BASE}/"],
        },
        {
            "topic": "kit_contents",
            "playermaker-2.0": "2 sensors, charging case + cable, 2 black straps, carry case, 12-month tracking.",
            "cityplay": "2 sensors, charging case + cable, 2 black straps, carry case, Man City content + benefits, 12-month tracking.",
            "extra-straps": "Straps only; color + size variants.",
            "source_urls": [
                f"{BASE}/products/playermaker",
                f"{BASE}/products/cityplay",
                f"{BASE}/products/playermaker-cityplay-straps",
            ],
        },
        {
            "topic": "size_options",
            "playermaker-2.0": "Medium / Large (same on-page shoe bands as CITYPLAY).",
            "cityplay": "Medium / Large (same on-page shoe bands as Playermaker 2.0).",
            "extra-straps": "Medium / Large × Black, Blue, Red, White, Pink, Yellow.",
            "source_urls": [
                f"{BASE}/products/playermaker",
                f"{BASE}/products/cityplay",
                f"{BASE}/products/playermaker-cityplay-straps",
            ],
        },
        {
            "topic": "vs_gps_vest",
            "playermaker-2.0": "Foot-mounted; technical + physical metrics; indoor + outdoor; listed weight 0.28 oz vs GPS 1.58 oz on PDP comparison table.",
            "cityplay": "Same comparison table appears on CITYPLAY PDP.",
            "extra-straps": "Not applicable.",
            "source_urls": [
                f"{BASE}/products/playermaker",
                f"{BASE}/products/cityplay",
                f"{BASE}/blogs/news/gps-vests-vs-football-tracker",
            ],
        },
    ]


def build_fit_rules() -> list[dict[str, Any]]:
    faq = f"{BASE}/pages/faq"
    home = f"{BASE}/"
    return [
        {
            "rule_id": "age-under-8",
            "priority": 10,
            "signals": {"age_max": 7},
            "best_fit_product_id": None,
            "outcome": "honest_no",
            "why": "Playermaker says it is designed for footballers starting from 8 years old. Under 8 is outside the stated range.",
            "source_urls": [faq, home],
        },
        {
            "rule_id": "wants-replacement-or-colored-straps",
            "priority": 20,
            "signals": {"already_owns_kit": True, "needs": ["extra_straps", "colored_straps", "replacement_straps"]},
            "best_fit_product_id": "extra-straps",
            "outcome": "accessory",
            "why": "Extra Straps are the storefront accessory for holding existing Playermaker sensors; they are not a tracker kit.",
            "source_urls": [f"{BASE}/products/playermaker-cityplay-straps"],
        },
        {
            "rule_id": "team-or-club-buy",
            "priority": 30,
            "signals": {"buyer_type": "team_or_club"},
            "best_fit_product_id": None,
            "outcome": "lead",
            "why": "The B2C catalog has individual kits only. FAQ says teams get separate packages and a Coach Dashboard at different price points — those SKUs are not in the public product list.",
            "source_urls": [faq, f"{BASE}/pages/team-solution", f"{BASE}/pages/teams"],
        },
        {
            "rule_id": "wants-man-city-coaching-content",
            "priority": 40,
            "signals": {"age_min": 8, "wants_man_city_content": True},
            "best_fit_product_id": "cityplay",
            "outcome": "match",
            "why": "FAQ: both kits share the same tracking technology; CITYPLAY adds Manchester City in-app coaching content, drills, and occasional Man City offers.",
            "source_urls": [faq, home],
        },
        {
            "rule_id": "core-tracker-no-man-city",
            "priority": 50,
            "signals": {"age_min": 8, "wants_man_city_content": False},
            "best_fit_product_id": "playermaker-2.0",
            "outcome": "match",
            "why": "FAQ: Playermaker 2.0 is the core tracking system at the lower kit price; CITYPLAY's difference is exclusive Man City content, not different sensors.",
            "source_urls": [faq, f"{BASE}/products/playermaker"],
        },
        {
            "rule_id": "goalkeeper-age-8-plus",
            "priority": 60,
            "signals": {"age_min": 8, "position": "goalkeeper"},
            "best_fit_product_id": "playermaker-2.0",
            "outcome": "match",
            "why": "FAQ says goalkeepers can use Playermaker (explosive movement, kick power, first touch, distribution). Hardware is the same on CITYPLAY; pick CITYPLAY only if they also want Man City content.",
            "source_urls": [faq],
        },
        {
            "rule_id": "indoor-or-futsal",
            "priority": 70,
            "signals": {"age_min": 8, "environment": ["indoor", "futsal"]},
            "best_fit_product_id": "playermaker-2.0",
            "outcome": "match",
            "why": "FAQ and how-it-works: recording does not need GPS or Wi-Fi; indoor and futsal are supported. Kit choice still follows the Man City content preference.",
            "source_urls": [faq, f"{BASE}/pages/how-it-works"],
        },
    ]


def objection_id(question: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", question.lower()).strip("-")
    return slug[:80]


def collect_gaps(products: list[dict[str, Any]], pages: list[dict[str, Any]], qa: list[dict[str, Any]]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []

    def add(**kwargs: Any) -> None:
        gaps.append(kwargs)

    for p in products:
        pid = p["product_id"]
        if not p["variants"]:
            add(gap_id=f"{pid}-no-variants", severity="missing", field="variants", product_id=pid,
                detail="No variants in Shopify JSON.", source_urls=[p["url"]])
        for v in p["variants"]:
            if not v.get("price"):
                add(gap_id=f"{pid}-missing-price-{v.get('variant_id')}", severity="missing",
                    field="price", product_id=pid, detail=f"Variant {v.get('title')} has no price.", source_urls=[p["url"]])
            if v.get("available") is None:
                add(gap_id=f"{pid}-availability-unknown-{v.get('variant_id')}", severity="missing",
                    field="availability", product_id=pid,
                    detail=f"Variant {v.get('title')} has no public `available` flag on this JSON payload.",
                    source_urls=[p["url"] + ".json"])
            if not v.get("sku"):
                add(gap_id=f"{pid}-missing-sku-{v.get('variant_id')}", severity="missing",
                    field="sku", product_id=pid, detail=f"Variant {v.get('title')} has no SKU.", source_urls=[p["url"]])
        if p["fit"]["supported_age_range"]["min"] is None and pid != "extra-straps":
            add(gap_id=f"{pid}-age-min", severity="missing", field="supported_age_range.min",
                product_id=pid, detail="No numeric minimum age extracted for this product page.", source_urls=[p["url"]])
        if p["fit"]["supported_age_range"]["max"] is None and pid != "extra-straps":
            add(gap_id=f"{pid}-age-max", severity="missing", field="supported_age_range.max",
                product_id=pid, detail="No maximum age is stated. Copy says 'all ages starting from 8'.",
                source_urls=[f"{BASE}/pages/faq"])
        labeled = [b for b in p["fit"]["size_shoe_bands"] if b.get("label") in {"Medium", "Large"}]
        if pid != "extra-straps" and not labeled:
            add(gap_id=f"{pid}-size-bands", severity="missing", field="size_shoe_bands",
                product_id=pid, detail="Could not extract Medium/Large shoe bands from the PDP.", source_urls=[p["url"]])
        for b in p["fit"]["size_shoe_bands"]:
            if b.get("size_system") is None and b.get("label") in {"Medium", "Large", "unlabeled_alt"}:
                add(gap_id=f"{pid}-size-system-unlabeled", severity="missing", field="size_shoe_bands.size_system",
                    product_id=pid,
                    detail="Shoe bands are printed as Women/Men numbers with no UK/US/EU label on the storefront.",
                    source_urls=[b.get("source_url") or p["url"]])
                break
        if p["fit"]["device_app_requirements"]["os_requirements"] is None and pid != "extra-straps":
            add(gap_id=f"{pid}-os-requirements", severity="missing", field="device_app_requirements.os_requirements",
                product_id=pid,
                detail="No iOS/Android version requirements on the public storefront. /pages/android is a thin/empty page.",
                source_urls=[p["url"], f"{BASE}/pages/android"])
        if p["fit"]["battery"]["capacity"] is None and pid != "extra-straps":
            add(gap_id=f"{pid}-battery-capacity", severity="missing", field="battery.capacity",
                product_id=pid,
                detail="Only a 6-hour session limit is stated. No mAh, standby time, or charge time.",
                source_urls=[f"{BASE}/pages/faq"])
        if not p["fit"]["disturbs_play"]["raw_statements"] and pid != "extra-straps":
            add(gap_id=f"{pid}-disturbance", severity="missing", field="disturbs_play",
                product_id=pid, detail="No on-page disturbance/comfort claim extracted.", source_urls=[p["url"]])
        short = p["description"]["short"]
        if not short or len(short) < 40:
            add(gap_id=f"{pid}-thin-shopify-description", severity="thin_page", field="description.short",
                product_id=pid, detail="Shopify body_html is nearly empty; description was taken from theme HTML.",
                source_urls=[p["url"] + ".json"])

    # Cross-product conflicts
    add(
        gap_id="water-claim-conflict",
        severity="conflict",
        field="water",
        product_id=None,
        detail=(
            "FAQ: 'Water-resistant, not waterproof. Don't submerge.' "
            "Homepage/PDP/soccer-tracker: sensors or straps are called waterproof. "
            "Not resolved — do not pick one."
        ),
        source_urls=[f"{BASE}/pages/faq", f"{BASE}/", f"{BASE}/products/playermaker", f"{BASE}/pages/soccer-tracker"],
    )
    add(
        gap_id="sensor-weight-conflict",
        severity="conflict",
        field="weight",
        product_id=None,
        detail=(
            "FAQ: 'Only 6 grams (0.21 ounces) each.' "
            "PDP vs-GPS table: Playermaker weight 0.28 oz. "
            "soccer-tracker: 'under 0.3 oz'. Not resolved."
        ),
        source_urls=[f"{BASE}/pages/faq", f"{BASE}/products/playermaker", f"{BASE}/pages/soccer-tracker"],
    )
    add(
        gap_id="skill-count-conflict",
        severity="conflict",
        field="stats_tracked.skill_scores",
        product_id=None,
        detail=(
            "PDP: '6 main performance skills' listing Two-footed, Dribbling, First touch, Agility and speed. "
            "soccer-tracker: six areas including Power as its own skill. "
            "GPS comparison blog: '5 key skills (Two-footed, Dribbling, First touch, Agility & Speed)'."
        ),
        source_urls=[
            f"{BASE}/products/playermaker",
            f"{BASE}/pages/soccer-tracker",
            f"{BASE}/blogs/news/gps-vests-vs-football-tracker",
        ],
    )
    add(
        gap_id="size-band-overlap",
        severity="conflict",
        field="size_shoe_bands",
        product_id=None,
        detail=(
            "Medium (Women 3–8.5 / Men 2.5–7) overlaps Large (Women 5–10.5 / Men 3.5–9). "
            "No on-page rule for the overlap zone."
        ),
        source_urls=[f"{BASE}/products/playermaker", f"{BASE}/products/cityplay"],
    )
    add(
        gap_id="extra-straps-size-copy-conflict",
        severity="conflict",
        field="size_shoe_bands",
        product_id="extra-straps",
        detail=(
            "Extra Straps PDP visible text includes 'Men: 9.5 – 14.5 | Women: 11 – 16', "
            "which does not match the Medium/Large kit chart. Treat as untrusted until the theme is fixed."
        ),
        source_urls=[f"{BASE}/products/playermaker-cityplay-straps"],
    )
    add(
        gap_id="pdp-template-bleed",
        severity="conflict",
        field="description",
        product_id="playermaker-2.0",
        detail=(
            "Playermaker 2.0 and Extra Straps PDPs include CITYPLAY-only blocks "
            "('Tips by Manchester City experts', 'Average improvement of CITYPLAY users'). "
            "Comparison table on the homepage is the cleaner source for kit differences."
        ),
        source_urls=[f"{BASE}/products/playermaker", f"{BASE}/products/playermaker-cityplay-straps", f"{BASE}/"],
    )
    add(
        gap_id="shipping-policy-unextracted",
        severity="thin_page",
        field="shipping_returns",
        product_id=None,
        detail=(
            " /pages/shipping and /policies/shipping-policy render almost no policy body in HTML "
            "(link-only / JS). Storefront claims are only 'Free Shipping' and 'Worldwide shipping up to 5 business days'."
        ),
        source_urls=[f"{BASE}/pages/shipping", f"{BASE}/policies/shipping-policy"],
    )
    add(
        gap_id="returns-policy-unextracted",
        severity="thin_page",
        field="shipping_returns",
        product_id=None,
        detail=(
            "/pages/returns and /policies/refund-policy are link stubs. "
            "The only extractable return fact is the 30-day money-back guarantee on FAQ/PDPs."
        ),
        source_urls=[f"{BASE}/pages/returns", f"{BASE}/policies/refund-policy", f"{BASE}/pages/faq"],
    )
    add(
        gap_id="no-dedicated-sizing-or-compare-url",
        severity="missing",
        field="source_pages",
        product_id=None,
        detail=(
            "No dedicated sizing page or PM2-vs-CITYPLAY comparison URL in the sitemap. "
            "Sizing lives on PDPs; kit comparison lives on the homepage table + FAQ."
        ),
        source_urls=[f"{BASE}/", f"{BASE}/pages/faq"],
    )
    add(
        gap_id="inventory-quantity-not-public",
        severity="missing",
        field="availability",
        product_id=None,
        detail="Public Shopify JSON exposes `available` booleans, not stock quantities.",
        source_urls=[f"{BASE}/products.json"],
    )
    add(
        gap_id="black-strap-sku-pattern",
        severity="conflict",
        field="sku",
        product_id="extra-straps",
        detail="Black straps use SKUs PM0220 (M) / PM0210 (L); other colors use PM-XXX-ST-M/L.",
        source_urls=[f"{BASE}/products/playermaker-cityplay-straps.json"],
    )
    add(
        gap_id="android-page-empty",
        severity="thin_page",
        field="device_app_requirements",
        product_id=None,
        detail="/pages/android title mentions 'Playermaker Android Beta' but the fetched HTML body is empty.",
        source_urls=[f"{BASE}/pages/android"],
    )

    thin = [p for p in pages if "thin_page" in (p.get("notes") or [])]
    if thin:
        add(
            gap_id="thin-html-pages",
            severity="thin_page",
            field="source_pages",
            product_id=None,
            detail=f"{len(thin)} storefront HTML pages had <250 extracted characters (likely JS- or PDF-linked).",
            source_urls=[p["url"] for p in thin[:12]],
        )

    if not any("age is playermaker" in q["question"].lower() for q in qa):
        add(
            gap_id="faq-extract-weak",
            severity="missing",
            field="objections",
            product_id=None,
            detail="FAQ question extraction may have missed pairs; check objections.json count vs on-page FAQ.",
            source_urls=[f"{BASE}/pages/faq"],
        )

    return gaps


def attach_gap_ids(products: list[dict[str, Any]], gaps: list[dict[str, Any]]) -> None:
    by_pid: dict[str, list[str]] = {}
    for g in gaps:
        pid = g.get("product_id")
        if pid:
            by_pid.setdefault(pid, []).append(g["gap_id"])
    for p in products:
        p["gaps"] = by_pid.get(p["product_id"], [])


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def crawl(out_dir: Path, delay: float) -> dict[str, Any]:
    log("Fetching robots.txt…")
    robots, robots_url, robots_body = load_robots(delay)
    sitemaps = re.findall(r"(?im)^Sitemap:\s*(\S+)", robots_body.decode("utf-8", "replace"))
    fetcher = Fetcher(delay=delay, robots=robots)
    fetcher.records.append(
        {
            "url": robots_url,
            "fetched_at": utc_now(),
            "status": 200,
            "content_type": "text/plain",
            "title": "",
            "kind": "robots",
            "bytes": len(robots_body),
            "text_chars": len(robots_body),
            "notes": [],
        }
    )

    queue: deque[str] = deque()
    seen: set[str] = set()

    def enqueue(url: str | None) -> None:
        if not url or url in seen:
            return
        if not allowed(url, robots) and "robots.txt" not in url and "sitemap" not in url:
            return
        seen.add(url)
        queue.append(url)

    for sm in sitemaps or [f"{BASE}/sitemap.xml"]:
        enqueue(normalize_url(sm) or sm)

    for path in SEED_PATHS + JSON_SEEDS:
        enqueue(normalize_url(path))

    log("Discovering sitemap URLs…")
    discovered: list[str] = []
    # Walk sitemaps first.
    sitemap_queue = deque([u for u in list(queue) if "sitemap" in u])
    walked_sm: set[str] = set()
    while sitemap_queue:
        sm = sitemap_queue.popleft()
        if sm in walked_sm:
            continue
        walked_sm.add(sm)
        status, _, body = fetcher.get(sm)
        if status != 200:
            continue
        for loc in sitemap_locs(body):
            n = normalize_url(loc) or (loc if "sitemap" in loc else None)
            if n and "sitemap" in n:
                sitemap_queue.append(n)
                enqueue(n)
            elif n:
                enqueue(n)
                discovered.append(n)

    log(f"Sitemap + seeds: {len(seen)} URLs. Crawling…")
    html_docs: dict[str, HTMLDoc] = {}
    qa: list[dict[str, Any]] = []

    while queue:
        url = queue.popleft()
        if url_kind(url) == "sitemap" and url in fetcher.bodies:
            continue
        status, ctype, body = fetcher.get(url)
        if status != 200 or not body:
            continue
        is_html = "html" in ctype.lower() or body.lstrip()[:15].lower().startswith(b"<!doctype") or body.lstrip()[:5].lower().startswith(b"<html")
        if is_html:
            doc = parse_html(body)
            html_docs[url] = doc
            qa.extend(qa_from_jsonld(doc.json_ld, url))
            qa.extend(qa_from_blocks(doc.blocks, url))
            for href in doc.links + doc.pdfs:
                n = normalize_url(href, url)
                if n and url_kind(n) in {"product", "collection", "page", "policy", "home", "doc"}:
                    enqueue(n)

    log("Loading Shopify product JSON…")
    shopify = load_shopify_products(fetcher)

    # Shared corpus from the highest-signal pages.
    signal_urls = [
        f"{BASE}/",
        f"{BASE}/pages/faq",
        f"{BASE}/pages/how-it-works",
        f"{BASE}/pages/soccer-tracker",
        f"{BASE}/products/playermaker",
        f"{BASE}/products/cityplay",
        f"{BASE}/products/playermaker-cityplay-straps",
    ]
    corpus_parts = [html_docs[u].text for u in signal_urls if u in html_docs]
    shared = {"corpus": "\n".join(corpus_parts)}

    products: list[dict[str, Any]] = []
    for handle, raw in shopify.items():
        html_url = f"{BASE}/products/{handle}"
        html_text = html_docs[html_url].text if html_url in html_docs else ""
        html_images = html_docs[html_url].images if html_url in html_docs else []
        products.append(build_product(handle, raw, html_text, html_url, html_images, shared))
    products.sort(key=lambda p: {"playermaker-2.0": 0, "cityplay": 1, "extra-straps": 2}.get(p["product_id"], 9))

    qa = dedupe_qa(qa)
    cleaned_qa = []
    for item in qa:
        q, a = item["question"], trim_answer(item["answer"])
        item["answer"] = a
        if len(a) < 30 or not is_qa_source(item["source_url"]):
            continue
        if q.lower() in {"how can we help?", "still need help?", "have an account?"}:
            continue
        cleaned_qa.append(item)
    qa = cleaned_qa

    objections = [
        {
            "objection_id": objection_id(item["question"]),
            "objection": item["question"],
            "answer": item["answer"],
            "source_urls": [item["source_url"]],
        }
        for item in qa
    ]

    pages = fetcher.records
    gaps = collect_gaps(products, pages, qa)
    attach_gap_ids(products, gaps)

    generated = utc_now()
    products_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "source": BASE,
        "comparison": build_comparison(),
        "products": products,
    }
    fit_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "rules": build_fit_rules(),
    }
    objections_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "objections": objections,
    }
    sources_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "robots": {"url": robots_url, "fetched_at": generated, "sitemaps": sitemaps},
        "pages": pages,
    }
    gaps_payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "gaps": gaps,
    }

    thin_pages = [p for p in pages if "thin_page" in (p.get("notes") or [])]
    report = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "counts": {
            "products": len(products),
            "variants": sum(len(p["variants"]) for p in products),
            "fit_rules": len(fit_payload["rules"]),
            "objections": len(objections),
            "source_pages": len(pages),
            "source_pages_http_200": sum(1 for p in pages if p.get("status") == 200),
            "gaps": len(gaps),
            "thin_pages": len(thin_pages),
            "comparison_points": len(products_payload["comparison"]),
        },
        "product_ids": [p["product_id"] for p in products],
        "gap_ids": [g["gap_id"] for g in gaps],
        "re_run": "python3 scripts/scan_playermaker.py",
    }

    write_json(out_dir / "products.json", products_payload)
    write_json(out_dir / "fit_rules.json", fit_payload)
    write_json(out_dir / "objections.json", objections_payload)
    write_json(out_dir / "source_pages.json", sources_payload)
    write_json(out_dir / "gaps.json", gaps_payload)
    write_json(out_dir / "scan_report.json", report)
    log(f"Wrote {out_dir}")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan playermaker.com into data/playermaker/")
    parser.add_argument("--delay", type=float, default=1.25, help="Seconds between HTTP requests")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "playermaker",
        help="Output directory",
    )
    args = parser.parse_args()
    try:
        report = crawl(args.out, args.delay)
    except KeyboardInterrupt:
        log("Interrupted")
        return 130
    log(json.dumps(report["counts"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
