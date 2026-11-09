// STUB (foundation commit): the agreed API only. The full footer replaces this file.
//
// <SiteFooter>{page-specific blocks}</SiteFooter>
//   Renders the page's own blocks (each a <section> with an <h3> and text), then what
//   every page shares: the privacy note, the like heart and the LinkedIn link.
import { CONTAINER } from "@/lib/layout.js";

export default function SiteFooter({ children }) {
  return (
    <footer data-slot="site-footer" className="mt-16 border-t">
      <div className={`${CONTAINER} grid gap-8 py-10 text-sm text-muted-foreground md:grid-cols-2`}>{children}</div>
    </footer>
  );
}
