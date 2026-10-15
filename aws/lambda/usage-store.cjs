// A daily allowance of paid résumé checks per account, and feedback that extends it.
//
// Every check that calls the model takes one from today's allowance (UTC day); a stored
// score shown again costs nothing and is never counted. The allowance is DAILY_LIMIT
// (25 unless MATCH_DAILY_LIMIT says otherwise). Once it is used up, the account can
// give feedback — a 1–5 rating and a written comment — for FEEDBACK_BONUS more checks
// (25 unless MATCH_FEEDBACK_BONUS says otherwise), at most FEEDBACK_UNLOCKS times a day
// (once unless MATCH_FEEDBACK_UNLOCKS says otherwise), so the daily ceiling is fixed.
//
// Counting happens in the database with a single conditional UPDATE, so two checks
// started at once cannot both take the last slot. A check whose model call fails gets
// its slot back (refund).
//
// Tables in aws/schema.sql. Shared by the dev server and, once deployed, the Lambda.

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

function settings(env = process.env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== "" && v != null ? Math.floor(Number(v)) : d);
  return {
    limit: n(env.MATCH_DAILY_LIMIT, 25),
    bonus: n(env.MATCH_FEEDBACK_BONUS, 25),
    unlocks: n(env.MATCH_FEEDBACK_UNLOCKS, 1),
  };
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const nextReset = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

const MIN_MESSAGE = 20;
const MAX_MESSAGE = 2000;

function createUsageStore(pool, env = process.env) {
  async function q(sql, params) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      if (err.status) throw err;
      throw fail(503, "Résumé checks are unavailable right now. Please try again shortly.");
    }
  }

  // What the page needs to say where someone stands today.
  function describe(row, s, now) {
    const used = row ? Number(row.used) : 0;
    const bonus = row ? Number(row.bonus) : 0;
    const unlocks = row ? Number(row.unlocks) : 0;
    const limit = s.limit + bonus;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      canUnlock: unlocks < s.unlocks && s.bonus > 0,
      bonus: s.bonus,
      resetsAt: nextReset(now),
    };
  }

  return {
    async usage(accountId, now = Date.now()) {
      const { rows } = await q("SELECT used, bonus, unlocks FROM match_usage WHERE account_id = $1 AND day = $2", [accountId, today(now)]);
      return describe(rows[0], settings(env), now);
    },

    /**
     * Take one check from today's allowance, or throw 429 with code "daily_limit"
     * and the current usage, which tells the page whether feedback can unlock more.
     */
    async take(accountId, now = Date.now()) {
      const s = settings(env);
      const day = today(now);
      await q("INSERT INTO match_usage (account_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING", [accountId, day]);
      const { rows } = await q(
        `UPDATE match_usage SET used = used + 1
          WHERE account_id = $1 AND day = $2 AND used < $3 + bonus
          RETURNING used, bonus, unlocks`,
        [accountId, day, s.limit]
      );
      if (rows.length) return describe(rows[0], s, now);
      const usage = await this.usage(accountId, now);
      throw fail(429,
        usage.canUnlock
          ? `You've used today's ${usage.limit} résumé checks. Share quick feedback to unlock ${usage.bonus} more.`
          : `You've used all ${usage.limit} résumé checks for today. More are available after the daily reset.`,
        { code: "daily_limit", usage });
    },

    /** Give back a check whose model call failed. */
    async refund(accountId, now = Date.now()) {
      await q("UPDATE match_usage SET used = GREATEST(0, used - 1) WHERE account_id = $1 AND day = $2", [accountId, today(now)]);
    },

    /**
     * Record feedback and, when today's unlock is still available, add the bonus.
     * The comment must say something (MIN_MESSAGE characters), and the rating is 1–5.
     */
    async feedback(accountId, { rating, message, jobId }, now = Date.now()) {
      const r = Number(rating);
      const text = typeof message === "string" ? message.trim() : "";
      if (!Number.isInteger(r) || r < 1 || r > 5) throw fail(400, "Choose a rating from 1 to 5.");
      if (text.length < MIN_MESSAGE) throw fail(400, `Please write at least ${MIN_MESSAGE} characters, so we know what to improve.`);
      const s = settings(env);
      const day = today(now);
      const before = await this.usage(accountId, now);
      if (!before.canUnlock) throw fail(409, "Feedback has already unlocked extra checks today.", { code: "no_unlock", usage: before });
      await q(
        "INSERT INTO match_feedback (account_id, rating, message, job_id, created_at) VALUES ($1, $2, $3, $4, $5)",
        [accountId, r, text.slice(0, MAX_MESSAGE), typeof jobId === "string" ? jobId.slice(0, 300) : null, now]
      );
      await q("INSERT INTO match_usage (account_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING", [accountId, day]);
      // Conditional, so two feedback submissions at once still unlock only once.
      const { rows } = await q(
        `UPDATE match_usage SET bonus = bonus + $3, unlocks = unlocks + 1
          WHERE account_id = $1 AND day = $2 AND unlocks < $4
          RETURNING used, bonus, unlocks`,
        [accountId, day, s.bonus, s.unlocks]
      );
      return rows[0] ? describe(rows[0], s, now) : this.usage(accountId, now);
    },
  };
}

module.exports = { createUsageStore, settings, MIN_MESSAGE };
