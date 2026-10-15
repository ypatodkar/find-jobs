const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { verifyGoogleIdToken, _resetKeyCache } = require("../aws/lambda/google-id.cjs");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const CLIENT = "test-client.apps.googleusercontent.com";
const fetch = async () => ({ ok: true, headers: { get: () => "public, max-age=3600" }, json: async () => ({ keys: [jwk] }) });

function token(claims, { kid = "k1", key = privateKey, alg = "RS256" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, sub: "123", email: "Jane@Example.com", email_verified: true, name: "Jane", iat: now, exp: now + 3600, ...claims })).toString("base64url");
  const s = crypto.sign("RSA-SHA256", Buffer.from(h + "." + p), key).toString("base64url");
  return `${h}.${p}.${s}`;
}

test.beforeEach(() => _resetKeyCache());

test("accepts a valid token and returns the account claims", async () => {
  const c = await verifyGoogleIdToken(token({}), CLIENT, { fetch });
  assert.deepEqual(c, { sub: "123", email: "jane@example.com", name: "Jane", picture: null });
});

test("rejects a token for another client", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ aud: "someone-else" }), CLIENT, { fetch }), /different site/);
});

test("rejects an expired token", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ exp: Math.floor(Date.now() / 1000) - 600 }), CLIENT, { fetch }), /expired/);
});

test("rejects a token not issued by Google", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ iss: "https://evil.example" }), CLIENT, { fetch }), /not issued by Google/);
});

test("rejects a token signed with a different key", async () => {
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyGoogleIdToken(token({}, { key: other }), CLIENT, { fetch }), /signature/);
});

test("rejects tampered claims", async () => {
  const [h, , s] = token({}).split(".");
  const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT, sub: "attacker", email: "a@b.c", email_verified: true, exp: 9e9 })).toString("base64url");
  await assert.rejects(verifyGoogleIdToken(`${h}.${p}.${s}`, CLIENT, { fetch }), /signature/);
});

test("rejects an unverified email and a non-RS256 header", async () => {
  await assert.rejects(verifyGoogleIdToken(token({ email_verified: false }), CLIENT, { fetch }), /not verified/);
  await assert.rejects(verifyGoogleIdToken(token({}, { alg: "none" }), CLIENT, { fetch }), /algorithm/);
});

test("refuses when no client id is configured", async () => {
  await assert.rejects(verifyGoogleIdToken(token({}), "", { fetch }), (e) => e.status === 503);
});
