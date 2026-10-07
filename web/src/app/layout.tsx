import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

const maison = localFont({
  src: [
    { path: "../../brand/fonts/MaisonNeue-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../brand/fonts/MaisonNeue-DemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-maison",
  display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playermaker — Help me decide",
  description: "A store-manager style guide for parents choosing a Playermaker kit for their player.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={maison.variable}>
      <body className={maison.className}>{children}</body>
    </html>
  );
}
