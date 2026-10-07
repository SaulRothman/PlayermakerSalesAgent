import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <Link href="/" aria-label="Playermaker">
          <img className="footer-logo" src="/brand/logo.svg" alt="" width={120} height={21} />
        </Link>
        <nav className="footer-links" aria-label="Footer">
          <a href="https://www.playermaker.com/pages/teams">For Teams</a>
          <a href="https://www.playermaker.com/products/playermaker-cityplay-straps">Accessories</a>
          <Link href="/help-me-decide">Help me choose</Link>
          <Link href="/faq">FAQ</Link>
          <a href="https://support.devrev.ai/playermaker/directories">Support</a>
        </nav>
      </div>
    </footer>
  );
}
