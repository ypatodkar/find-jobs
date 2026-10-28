// Shared authenticated API for the local dev server and the production Lambda.
const { createStore, poolFromEnv } = require('./match-store.cjs');
const { createAccountStore } = require('./account-store.cjs');
const { createUsageStore, isUnlimited } = require('./usage-store.cjs');
const { verifyGoogleIdToken } = require('./google-id.cjs');
const { createFileStore, readUpload, keyFor } = require('./file-store.cjs');
const { toPlainText } = require('../../shared/description');
const jev = require('../../shared/jev');

function createAccountApi({ getDescription, env = process.env }) {
  const jobDescription = getDescription;
  const MAX_BODY = 256 * 1024;
  // A resume upload carries its original file, base64, up to 4 MB (file-store.cjs);
  // the Lambda Function URL itself refuses requests over 6 MB.
  const MAX_UPLOAD_BODY = 5.8 * 1024 * 1024;
  const COOKIE = "fj_session";
  let budget = { hour: -1, used: 0 };
  let pool = null;
  let store = null;
  let accounts = null;
  const db = () => pool || (pool = poolFromEnv(env));
  const matchStore = () => store || (store = createStore(db()));
  const accountStore = () => accounts || (accounts = createAccountStore(db()));
  let usage = null;
  const usageStore = () => usage || (usage = createUsageStore(db(), env));
  let files = null;
  const fileStore = () => (files === null ? (files = createFileStore(env) || false) : files) || null;
  const httpError = (status, message) => Object.assign(new Error(message), { status });

  function readBody(req, limit = MAX_BODY) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
        reject(httpError(415, "Requests must be JSON."));
        return;
      }
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(httpError(413, "That request is too large."));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(httpError(400, "The request was not valid JSON.")); }
      });
      req.on("error", reject);
    });
  }

  function sessionToken(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || "");
    try { return m ? decodeURIComponent(m[1]) : null; }
    catch { return null; }
  }

  function sessionCookie(req, token, maxAge) {
    // Secure only over HTTPS: the dev server is plain http on localhost, where a Secure
    // cookie would never be sent back.
    const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
    return `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? maxAge : 0}${secure}`;
  }

  async function requireAccount(req) {
    const account = await accountStore().fromSession(sessionToken(req));
    if (!account) throw httpError(401, "Sign in with Google to use resume matching.");
    return account;
  }

  async function handleMatch(account, body) {
    const resumeId = body?.resume_id;
    const jobId = typeof body?.job_id === "string" ? body.job_id : "";
    const title = typeof body?.title === "string" ? body.title.slice(0, 300) : "";
    if (!jobId || jobId.length > 300) throw httpError(400, "No job was given to compare against.");
    const store = matchStore();
    const job = await jobDescription(jobId);

    if (!body.force) {
      const stored = await store.getMatch(account.id, resumeId, jobId, { rubric: jev.RUBRIC_VERSION, descHash: job.hash });
      if (stored && !stored.stale) return stored;
    }
    const resume = await store.body(account.id, resumeId); // also proves the resume is theirs
    if (!env.TYPESAFE_API_KEY) throw httpError(503, "Resume matching is not configured on this server.");
    if (toPlainText(job.html).length < 80) throw httpError(422, "This job has no description to compare against.");

    // A ceiling on paid calls per clock hour, so a stuck loop or a busy afternoon cannot
    // run the bill up. Stored scores above do not count against it.
    const hour = Math.floor(Date.now() / 3600000);
    if (budget.hour !== hour) budget = { hour, used: 0 };
    const limit = Number(env.MATCH_HOURLY_BUDGET) || 200;
    if (budget.used >= limit) throw httpError(429, "The hourly limit for resume matching has been reached. Please try again later.");

    // This person's daily allowance (usage-store.cjs): throws 429 "daily_limit" when it
    // is used up, which the page answers with the feedback form. A failed model call
    // gives the check back, so an outage never eats anyone's allowance. Accounts listed
    // in MATCH_UNLIMITED_EMAILS are counted but never refused.
    const allowance = await usageStore().take(account.id, Date.now(), { unlimited: isUnlimited(account, env) });
    budget.used++;
    let assessment;
    try {
      assessment = await jev.assess(resume, { job_id: jobId, title, html: job.html });
    } catch (err) {
      await usageStore().refund(account.id).catch(() => {});
      budget.used = Math.max(0, budget.used - 1);
      throw err;
    }
    const saved = await store.saveMatch(resumeId, jobId, assessment, job.hash);
    return { ...saved, usage: allowance };
  }

  // Returns [status, body, headers?] for every /api/auth, /api/sync, /api/resumes and
  // /api/match request.
  async function handleAccountApi(req, route, query) {
    const m = req.method;

    if (route === "/api/auth/config" && m === "GET") return [200, { clientId: env.GOOGLE_CLIENT_ID || null }];
    if (route === "/api/auth/me" && m === "GET") return [200, { account: await accountStore().fromSession(sessionToken(req)) }];
    if (route === "/api/auth/google" && m === "POST") {
      const b = await readBody(req);
      const claims = await verifyGoogleIdToken(b?.credential, env.GOOGLE_CLIENT_ID);
      const r = await accountStore().signIn(claims, b?.visitor, { seen: b?.seen, filters: b?.filters, saved: b?.saved });
      const { token, maxAge, ...out } = r;
      return [200, out, { "set-cookie": sessionCookie(req, token, maxAge) }];
    }
    if (route === "/api/auth/logout" && m === "POST") {
      await readBody(req);
      await accountStore().signOut(sessionToken(req));
      return [200, { ok: true }, { "set-cookie": sessionCookie(req, null) }];
    }

    const account = await requireAccount(req);

    if (route === "/api/match/usage" && m === "GET") return [200, { usage: await usageStore().usage(account.id, Date.now(), { unlimited: isUnlimited(account, env) }) }];
    // Feedback that unlocks more checks once today's are used up (usage-store.cjs).
    // Not /api/match/feedback: that is the per-analysis thumbs up/down review.
    if (route === "/api/match/unlock" && m === "POST") {
      const b = await readBody(req);
      return [200, { usage: await usageStore().feedback(account.id, { rating: b?.rating, message: b?.message, jobId: b?.job_id }) }];
    }

    if (route === "/api/sync" && m === "GET") return [200, await accountStore().getSync(account.id)];
    if (route === "/api/sync/seen" && m === "POST") {
      await accountStore().addSeen(account.id, (await readBody(req))?.seen);
      return [200, { ok: true }];
    }
    if (route === "/api/sync/saved" && m === "PUT") {
      await accountStore().putSaved(account.id, (await readBody(req))?.items);
      return [200, { ok: true }];
    }
    if (route === "/api/sync/filters" && m === "PUT") {
      await accountStore().putFilters(account.id, (await readBody(req))?.items);
      return [200, { ok: true }];
    }
    if (route === "/api/resumes" && m === "GET") return [200, { resumes: await matchStore().list(account.id) }];
    // The original file and the text the browser extracted from it arrive together.
    // The file is stored first, under the id the row will have; if the row then cannot
    // be written, the file is removed again, so no file is ever kept without its row.
    if (route === "/api/resumes" && m === "POST") {
      const b = await readBody(req, MAX_UPLOAD_BODY);
      const store = matchStore();
      const upload = b?.file && fileStore() ? readUpload(b.file) : null;
      const id = store.newId();
      const file = upload ? { key: keyFor(account.id, id, upload.ext), type: upload.type, size: upload.size } : null;
      if (file) await fileStore().put(file.key, upload.bytes, file.type);
      try {
        return [200, { resume: await store.add(account.id, b?.visitor, { id, label: b?.label, fileName: b?.fileName, body: b?.text, file }) }];
      } catch (err) {
        if (file) await fileStore().remove(file.key).catch(() => {});
        throw err;
      }
    }
    // The row stays (soft delete); its file is tagged so the bucket erases it in 30 days.
    // A failed tag does not undo the delete the person asked for, but it is logged,
    // since that file would then be kept indefinitely.
    if (route.startsWith("/api/resumes/") && m === "DELETE") {
      const key = await matchStore().remove(account.id, decodeURIComponent(route.slice("/api/resumes/".length)));
      if (key && fileStore()) await fileStore().markDeleted(key).catch((err) => console.error(`Could not mark ${key} deleted: ${err.message}`));
      return [200, { ok: true }];
    }
    if (route === "/api/match" && m === "GET") {
      const jobId = query.get("job") || "";
      const job = await jobDescription(jobId);
      const stored = await matchStore().getMatch(account.id, query.get("resume"), jobId, { rubric: jev.RUBRIC_VERSION, descHash: job.hash });
      return [200, stored && stored.stale ? { match: null, stale: stored } : { match: stored }];
    }
    if (route === "/api/match/feedback" && m === "POST") {
      return [200, { feedback: await matchStore().reviewMatch(account.id, await readBody(req)) }];
    }
    if (route === "/api/match" && m === "POST") return [200, await handleMatch(account, await readBody(req))];
    throw httpError(404, "Not found.");
  }

  return { handle: handleAccountApi, migrate: (sql) => db().query(sql), close: () => pool?.end() };
}
module.exports = { createAccountApi };
