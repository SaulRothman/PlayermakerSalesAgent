import type { Metadata } from "next";
import { Oswald, Source_Sans_3 } from "next/font/google";

import "./globals.css";

const display = Oswald({ subsets: ["latin"], variable: "--font-display" });
const body = Source_Sans_3({ subsets: ["latin"], variable: "--font-body" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playermaker — Help me decide",
  description: "A store-manager style guide for parents choosing a Playermaker kit for their player.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className={body.className}>{children}</body>
    </html>
  );
}
