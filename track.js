// Click tracking. Records which roles get opened; renders nothing.
//
// Fire-and-forget by design: if the Worker is unreachable, misconfigured, or blocked,
// the click still opens the job as normal. Nothing here is allowed to be on the
// critical path of a user applying for a job.
(function () {
  "use strict";

  // Your deployed Worker, e.g. "https://vcjobs-clicks.<subdomain>.workers.dev".
  // Left blank the tracker is inert, which is what you want for local development.
  var ENDPOINT = "";

  if (!ENDPOINT || !navigator.sendBeacon) return;

  var page = location.pathname.split("/").pop() || "index.html";
  var firm = new URLSearchParams(location.search).get("id");

  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest && e.target.closest("a.job-title[data-job-id]");
      if (!a || !a.dataset.jobId) return;

      // A plain string goes out as text/plain, which is a CORS-simple request — no
      // preflight, so the Worker needs no OPTIONS handler. A Blob tagged
      // application/json would trigger one.
      try {
        navigator.sendBeacon(
          ENDPOINT + "/click",
          JSON.stringify({
            job_id: a.dataset.jobId,
            company: a.dataset.company || null,
            title: a.textContent || null,
            city: a.dataset.city || null,
            page: page,
            firm: firm,
          })
        );
      } catch (_) {
        /* tracking must never break the link */
      }
    },
    true
  );
})();
