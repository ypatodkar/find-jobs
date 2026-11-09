// The site footer.
//
// <SiteFooter>{page-specific blocks}</SiteFooter>
//   Renders the page's own blocks (each a <section> with an <h3> and text), then what
//   every page shares: the privacy note, the like heart and the LinkedIn link.
//
// The blocks are styled from here (the h3s, paragraphs and links inside them), so a
// page writes plain markup. The footer sits at the foot of the window on a short page:
// each page's <main> is a full-height flex column, and the footer takes the slack above
// it (mt-auto), with at least the top padding between it and the content.
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONTAINER } from "@/lib/layout.js";
import { Heart } from "./HeaderExtras.jsx";

/**
 * What is kept where: present and findable on every page, set smaller than anything
 * else, never shouting.
 */
export function PrivacyNote({ className }) {
  return (
    <p className={cn("privacy-note max-w-[78ch] text-xs leading-relaxed text-muted-foreground", className)}>
      Browsing preferences are saved in this browser. Optional Google sign-in saves your
      account, resumes, saved jobs, and analysis results on our server. Resume analysis
      sends extracted resume text and the job description to TypeSafe AI. Removing a resume
      hides it from your account, but its stored text and match results stay on our server;
      clearing browser data does not delete server records either. <a className="font-medium text-foreground underline underline-offset-4" href="about.html">More about your data</a>.
    </p>
  );
}

// lucide has no LinkedIn logo (it dropped brand marks), so the mark is drawn here, on
// currentColor, so it takes the button's colour and the theme with it.
function LinkedIn() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
          <a href="https://lnkd.in/p/g2hge79J" target="_blank" rel="noopener noreferrer" aria-label="This project on LinkedIn">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true" focusable="false">
              <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8.02h4.56V24H.22zM8.34 8.02h4.37v2.18h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V24h-4.56v-7.28c0-1.74-.03-3.98-2.42-3.98-2.42 0-2.79 1.89-2.79 3.85V24H8.34z" />
            </svg>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>LinkedIn</TooltipContent>
    </Tooltip>
  );
}

// The page's blocks: a heading and a few lines each, side by side from md.
const BLOCKS = cn(
  "grid gap-x-12 gap-y-8 md:grid-cols-2",
  "[&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground",
  "[&_p]:max-w-prose [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_p+p]:mt-2",
  "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4",
);

export default function SiteFooter({ children }) {
  return (
    <footer data-slot="site-footer" className="mt-auto pt-16">
      <div className="border-t">
        <div className={cn(CONTAINER, "py-10")}>
          {children ? <div className={BLOCKS}>{children}</div> : null}
          <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", children && "mt-10 border-t pt-6")}>
            <PrivacyNote />
            <div className="-my-1 -ml-2 flex shrink-0 items-center gap-1 sm:-mr-2 sm:ml-0">
              <Heart />
              <LinkedIn />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
