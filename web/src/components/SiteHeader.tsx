import Link from "next/link";

const LINKS = [
  { href: "/products", label: "Kits" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link className="brand" href="/">
          Playermaker
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <Link className="btn" href="/help-me-decide">
          Help me decide
        </Link>
      </div>
    </header>
  );
}
