// The daily résumé-check allowance (aws/lambda/usage-store.cjs), against an in-memory
// stand-in for the match_usage table that answers the store's few statements.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createUsageStore, isUnlimited } = require("../aws/lambda/usage-store.cjs");

function fakePool() {
  const rows = new Map(); // "account|day" -> { used, bonus, unlocks }
  const row = (a, d) => rows.get(`${a}|${d}`);
  return {
    rows,
    async query(sql, params) {
      const [account, day] = params;
      if (sql.startsWith("INSERT INTO match_usage")) {
        if (!row(account, day)) rows.set(`${account}|${day}`, { used: 0, bonus: 0, unlocks: 0 });
        return { rows: [] };
      }
      if (sql.startsWith("SELECT used, bonus, unlocks")) return { rows: row(account, day) ? [{ ...row(account, day) }] : [] };
      if (sql.includes("SET used = used + 1")) {
        const r = row(account, day);
        const limited = sql.includes("used < $3 + bonus");
        if (!r || (limited && !(r.used < params[2] + r.bonus))) return { rows: [] };
        r.used++;
        return { rows: [{ ...r }] };
      }
      throw new Error("unexpected statement: " + sql);
    },
  };
}

const ENV = { MATCH_DAILY_LIMIT: "5", MATCH_FEEDBACK_BONUS: "5", MATCH_FEEDBACK_UNLOCKS: "1", MATCH_UNLIMITED_EMAILS: " Owner@Example.com , other@example.com" };

test("a normal account gets its daily checks, then is refused with the unlock offer", async () => {
  const store = createUsageStore(fakePool(), ENV);
  for (let i = 1; i <= 5; i++) assert.equal((await store.take("acct")).remaining, 5 - i);
  await assert.rejects(store.take("acct"), (err) => err.status === 429 && err.code === "daily_limit" && err.usage.canUnlock === true);
});

test("an unlimited account is never refused, and its checks are still counted", async () => {
  const pool = fakePool();
  const store = createUsageStore(pool, ENV);
  let last;
  for (let i = 0; i < 20; i++) last = await store.take("owner", Date.now(), { unlimited: true });
  assert.equal(last.used, 20);
  assert.equal(last.unlimited, true);
  assert.equal(last.canUnlock, false);
  assert.ok(last.remaining > 5, "the page is never told it is close to a limit");
  const [counted] = [...pool.rows.values()];
  assert.equal(counted.used, 20);
  assert.equal((await store.usage("owner", Date.now(), { unlimited: true })).remaining, last.remaining);
});

test("unlimited accounts are matched by email, ignoring case and spaces", () => {
  assert.equal(isUnlimited({ email: "owner@example.com" }, ENV), true);
  assert.equal(isUnlimited({ email: "OTHER@example.com " }, ENV), true);
  assert.equal(isUnlimited({ email: "someone@example.com" }, ENV), false);
  assert.equal(isUnlimited({ email: "owner@example.com" }, {}), false);
  assert.equal(isUnlimited(null, ENV), false);
});
