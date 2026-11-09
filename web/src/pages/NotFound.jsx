// The page for a link that leads nowhere (404.html): the site's header, a short
// explanation, and the two ways back in.
//
// The host serves 404.html at whatever unknown path was asked for, so the links here are
// absolute, and 404.html sets <base href="/"> so the header's relative links and the
// page's own scripts resolve from the site's root too.
import { Compass } from "lucide-react";
import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CONTAINER } from "../lib/layout.js";

export default function NotFound() {
  return (
    <>
      <SiteHeader active={null} country={null} account={false} />
      <div className={CONTAINER}>
        <Empty className="py-20 md:py-28">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Compass /></EmptyMedia>
            <p className="text-sm font-medium text-muted-foreground tabular">404</p>
            <EmptyTitle><h1 id="content" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">That page isn't here</h1></EmptyTitle>
            <EmptyDescription>
              The link may be out of date, or the role may have come off the boards. Everything still open is on the main list.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-md flex-row flex-wrap justify-center gap-2">
            <Button asChild><a href="/">Browse all engineering roles</a></Button>
            <Button asChild variant="outline"><a href="/firms.html">Browse by investor</a></Button>
          </EmptyContent>
        </Empty>
      </div>
      <SiteFooter />
    </>
  );
}
