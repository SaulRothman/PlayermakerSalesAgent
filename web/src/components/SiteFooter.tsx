import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <p>For parents deciding if this is right for their player. We will say no when it isn’t.</p>
        <p>
          <Link href="/help-me-decide">Help me decide</Link>
          {" · "}
          <Link href="/products">Kits</Link>
          {" · "}
          <Link href="/faq">FAQ</Link>
        </p>
      </div>
    </footer>
  );
}
