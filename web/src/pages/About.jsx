// The about page (about.html): static text, with the plain header (no likes, counter
// or feedback, as before).
import Masthead from "../components/Masthead.jsx";

export default function About() {
  return (
    <div className="wrap">
      <Masthead nav={[["index.html", "← Find Jobs"], ["firms.html", "All investors"]]} extras={false}>
        <h1 className="title">About</h1>
        <p className="dek">Why this list exists, who it is for, and what it does not claim to do.</p>
      </Masthead>

      <div className="about">
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
      </div>

      <footer>
        <div>
          <h3>Something missing?</h3>
          <p>If a company or an investor should be here and isn't, or a listing looks wrong, the feedback button in the corner of the job list goes straight to me.</p>
        </div>
        <div>
          <h3>Start looking</h3>
          <p>Go to <a href="index.html">the full list</a>, or browse <a href="firms.html">by investor</a> if you would rather start from a portfolio you already follow.</p>
        </div>
      </footer>
    </div>
  );
}
