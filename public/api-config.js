// Where the analytics API lives.
//
// One definition, because five files used to hold their own copy of this URL and the
// move to AWS would otherwise have been five chances to update four of them. track.js,
// heart.js, counter.js, feedback.js and presets.js all read it.
//
// This is a Lambda behind a Function URL, sitting in the same VPC as the Postgres
// instance that replaced D1. The Cloudflare Worker it succeeded is still deployed and
// still answers, but nothing points at it any more — worth knowing if click counts
// ever look like they are landing in two places.
//
// Each reader keeps its own fallback literal, so a stale cached page that misses this
// script loses its click tracking rather than throwing on load and taking the job list
// down with it.
window.API_ENDPOINT = "https://v7ogkcujy5bcq6hhyygjrs6v5y0xygut.lambda-url.us-east-1.on.aws";
