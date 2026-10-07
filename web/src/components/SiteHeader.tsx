import Link from "next/link";

const LINKS: Array<{ href: string; label: string; external?: boolean }> = [
  { href: "https://www.playermaker.com/products/playermaker", label: "Playermaker 2.0", external: true },
  { href: "https://www.playermaker.com/products/cityplay", label: "CITYPLAY", external: true },
  { href: "https://www.playermaker.com/products/playermaker-cityplay-straps", label: "Accessories", external: true },
  { href: "/help-me-decide", label: "Help me choose" },
  { href: "https://www.playermaker.com/pages/teams", label: "For Teams", external: true },
  { href: "/faq", label: "FAQ" },
  { href: "https://support.devrev.ai/playermaker/directories", label: "Support", external: true },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <div className="header-wrapper">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Playermaker">
          <img src="/brand/logo.svg" alt="Playermaker" width={160} height={28} />
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) =>
            l.external ? (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            ),
          )}
        </nav>
        <a className="header-buy" href="https://www.playermaker.com/products/playermaker">
          Buy Now
        </a>
        <details className="nav-drawer">
          <summary aria-label="Menu">Menu</summary>
          <nav aria-label="Primary mobile">
            {LINKS.map((l) =>
              l.external ? (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ) : (
                <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        </details>
      </header>
    </div>
  );
}
