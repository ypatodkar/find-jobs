// Verifying a "Sign in with Google" ID token, with no library.
//
// The browser gets a signed JWT from Google Identity Services and posts it here. It is
// only trusted after every check below passes: the signature against Google's
// published keys, the issuer, the audience (this site's OAuth client id), the expiry,
// and that Google has verified the email. Anything else is a 401.
//
// Shared by the dev server and, when auth is deployed, the Lambda.

const crypto = require("crypto");

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const SKEW_S = 60; // tolerated clock difference, in seconds

function fail(message) {
  return Object.assign(new Error(message), { status: 401 });
}

// Google rotates its keys every few weeks and says how long each set may be cached.
// A token naming a key we have not seen forces one refetch, so a rotation never locks
// people out until the cache expires.
let cache = { keys: null, until: 0 };

async function fetchKeys(fetcher) {
  const res = await fetcher(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw Object.assign(new Error("Could not reach Google to verify sign-in."), { status: 503 });
  const { keys } = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get("cache-control") || "") || [])[1]) || 3600;
  cache = { keys: new Map(keys.map((k) => [k.kid, k])), until: Date.now() + maxAge * 1000 };
  return cache.keys;
}

async function keyFor(kid, fetcher) {
  if (!cache.keys || Date.now() > cache.until || !cache.keys.has(kid)) await fetchKeys(fetcher);
  const jwk = cache.keys.get(kid);
  if (!jwk) throw fail("Sign-in token was signed with an unknown key.");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw fail("Sign-in token is malformed.");
  }
}

/**
 * Verify `token` for `clientId`. Resolves to the claims the account needs:
 * { sub, email, name, picture }. Rejects with status 401 on any failed check.
 */
async function verifyGoogleIdToken(token, clientId, options = {}) {
  if (!clientId) throw Object.assign(new Error("Google sign-in is not configured on this server."), { status: 503 });
  if (typeof token !== "string" || token.split(".").length !== 3) throw fail("Sign-in token is malformed.");
  const [h, p, s] = token.split(".");
  const header = decodePart(h);
  const claims = decodePart(p);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw fail("Sign-in token uses an unexpected algorithm.");

  const key = await keyFor(header.kid, options.fetch || fetch);
  const ok = crypto.verify("RSA-SHA256", Buffer.from(h + "." + p), key, Buffer.from(s, "base64url"));
  if (!ok) throw fail("Sign-in token signature is invalid.");

  const now = Math.floor((options.now || Date.now()) / 1000);
  if (!ISSUERS.has(claims.iss)) throw fail("Sign-in token was not issued by Google.");
  if (claims.aud !== clientId) throw fail("Sign-in token was issued for a different site.");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < now) throw fail("Sign-in token has expired. Please sign in again.");
  if (typeof claims.iat === "number" && claims.iat - SKEW_S > now) throw fail("Sign-in token is not valid yet.");
  if (!claims.sub || !claims.email) throw fail("Sign-in token is missing the account.");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw fail("That Google account's email is not verified.");

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: claims.name ? String(claims.name).slice(0, 120) : null,
    picture: typeof claims.picture === "string" && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 500) : null,
  };
}

// For tests: forget cached keys.
function _resetKeyCache() { cache = { keys: null, until: 0 }; }

module.exports = { verifyGoogleIdToken, _resetKeyCache };
