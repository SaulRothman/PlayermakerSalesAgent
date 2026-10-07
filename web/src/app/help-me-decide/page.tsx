import type { Metadata } from "next";

import { DecideExperience } from "@/components/DecideExperience";
import { fetchObjections, fetchProducts, firstImage, firstPrice } from "@/lib/catalog";
import { buildCanvasCards, type CanvasCard } from "@/lib/canvas-registry";
import type { ShelfItem } from "@/lib/funnel";

export const metadata: Metadata = {
  title: "Help me choose — Playermaker",
};

export default async function HelpMeDecidePage() {
  let cards: CanvasCard[] = [];
  let shelf: ShelfItem[] = [];
  try {
    const [objections, products] = await Promise.all([fetchObjections(), fetchProducts()]);
    cards = buildCanvasCards({ objections: objections.objections, products: products.products });
    shelf = products.products.map((product) => ({
      product_id: product.product_id,
      name: product.name,
      price: firstPrice(product),
      url: product.url || null,
      image_url: firstImage(product),
      what_it_does: product.description?.what_it_does || "",
      role: product.role,
      available: product.variants.some((variant) => variant.available !== false),
    }));
  } catch {
    cards = [];
    shelf = [];
  }
  return <DecideExperience cards={cards} shelf={shelf} />;
}
