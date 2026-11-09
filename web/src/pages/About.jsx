// The about page (about.html): why the list exists, set as an article at a measure
// narrow enough to read comfortably, which the rest of the site has no need for because
// it is all lists and controls. Under the lead, the live count of job clicks (it stays
// absent until there are enough to mean something; see Counter).
import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { Counter } from "../components/HeaderExtras.jsx";
import { CONTAINER } from "../lib/layout.js";

// Prose: headings, paragraphs, lists and links styled from the article down, so the
// text below stays plain markup.
const PROSE = [
  "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_p]:leading-7 [&_p:not(:first-child)]:mt-4",
  "[&_strong]:font-semibold",
  "[&_ul]:my-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mt-2 [&_li]:leading-7",
  "[&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-muted-foreground",
].join(" ");

const FOOT_H = "mb-2 text-sm font-medium text-foreground";
const LINK = "rounded-sm underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

export default function About() {
  return (
    <>
      <SiteHeader active="about" country={null} account={false} />
      <div className={CONTAINER}>
        <article className={`mx-auto max-w-2xl pt-10 pb-4 md:pt-14 ${PROSE}`}>
          <header>
            <h1 className="text-3xl font-semibold tracking-tight">About</h1>
            <p className="mt-3 text-lg text-muted-foreground">Why this list exists, who it is for, and what it does not claim to do.</p>
            <div className="mt-4 text-sm text-muted-foreground empty:hidden"><Counter /></div>
          </header>

          <section>
            <h2>Why I built it</h2>
            <p>
              I applied for jobs every day for about six months. I did not get a single online
              assessment or recruiter call in that time. The problem was not effort — it was that
              every role I could find had already been found by everyone else. The listings that
              reach you first are the ones reaching several hundred other people at the same time.
            </p>
            <p>
              So I stopped applying through the places that surface the same jobs to everyone, and
              started going directly to the job boards of companies backed by venture firms —
              companies doing serious engineering that most people have never heard of. Within five
              days I had one online assessment and one recruiter call.
            </p>
            <p>
              I am one person and five days is not evidence. But the mechanism is not mysterious:
              when I cross-checked roles from this list against the same postings on LinkedIn, the
              ones here were typically showing around a hundred applicants, against eight hundred
              or more for the roles that had been recommended to me. The jobs are not better. There
              are simply fewer people applying, because nobody has heard of the company.
            </p>
            <p>
              I built this so I would not have to check sixteen hundred career pages by hand. It is
              now public because the problem was never specific to me.
            </p>
          </section>

          <section>
            <h2>What it is</h2>
            <p>
              Around <strong>12,000 engineering roles</strong> at more than{" "}
              <strong>1,600 companies</strong>, drawn from the portfolios of{" "}
              <strong>70 US venture firms</strong>, across <strong>19 US metros</strong> plus remote.
            </p>
            <p>
              Where a company publishes to its own applicant tracking system, that listing is read
              directly and preferred over the investor's board, which tends to lag. Everything is
              re-checked twice a day. You can filter by city, seniority, company, company size,
              role, industry, funding stage, salary and investor, and save any combination of those
              to come back to.
            </p>
          </section>

          <section>
            <h2>Who it is for</h2>
            <p>
              Software engineers who are tired of applying into listings with eight hundred
              applicants — particularly new graduates and early-career engineers, for whom that
              ratio is the whole problem.
            </p>
          </section>

          <section>
            <h2>What it does not do</h2>
            <p>
              It is not faster than the big job boards. Most of what is listed here has been open
              for weeks; only a small fraction was posted in the last few days. If you are looking
              for a feed of everything posted in the last hour, this is the wrong tool. The
              advantage here is reach into companies you would not otherwise find, not speed.
            </p>
            <p>
              It does not cover every company, or every city, or non-engineering roles. It cannot
              tell you whether a company is any good. And a listing occasionally outlives the job —
              boards are not always tidied up after a role is filled.
            </p>
          </section>

          <section>
            <h2>What it costs, and what it knows about you</h2>
            <p>
              Browsing is free. The site saves a random browser ID and your preferences locally.
              Optional Google sign-in stores your Google account ID, email, name, saved jobs,
              and saved filters on our server so they can follow you between devices. Google
              handles your password; this site does not receive it.
            </p>
            <p>
              Uploaded resumes are read in your browser, and their extracted text is stored on
              our server. When you request an analysis, that text and the job description are
              sent to TypeSafe AI. We store the result and any analysis feedback you submit.
              Removing a resume hides it from your account and stops it being used for analysis,
              but its stored text, match results, and per-analysis reviews are kept on our server.
              Clearing browser data removes local preferences, but does not delete server records.
              General feedback and daily-limit feedback are stored separately.
            </p>
          </section>
        </article>
      </div>

      <SiteFooter>
        <section>
          <h3 className={FOOT_H}>Something missing?</h3>
          <p className="leading-6">If a company or an investor should be here and isn't, or a listing looks wrong, the Feedback button at the top of every page goes straight to me.</p>
        </section>
        <section>
          <h3 className={FOOT_H}>Start looking</h3>
          <p className="leading-6">Go to <a className={LINK} href="index.html">the full list</a>, or browse <a className={LINK} href="firms.html">by investor</a> if you would rather start from a portfolio you already follow.</p>
        </section>
      </SiteFooter>
    </>
  );
}
