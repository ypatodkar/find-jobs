// Google sign-in, and keeping a signed-in account in step with this browser, as auth.js.
//
// The button and the token come from Google Identity Services. The token goes to
// POST api/auth/google, which verifies it and answers with a session cookie the page
// cannot read (HttpOnly), so nothing here ever holds a credential.
//
// Signing in sends what this browser already had (opened jobs, saved filters, saved
// jobs) with the token, and the account's merged copy comes back. While signed in, each
// change is copied to the account, and a page load pulls the account's copy.
import { useSyncExternalStore } from "react";
import { seenStore } from "./seen.js";
import { presets } from "./presets.js";
import { saved, savedItems } from "./saved.js";
import { adoptName, visitorId } from "./visitor.js";

const API = "api";
const GSI = "https://accounts.google.com/gsi/client";

// { ready, enabled, account, signInOpen, error }
let state = { ready: false, enabled: false, account: null, signInOpen: false, error: "" };
const listeners = new Set();
const accountListeners = new Set();
function set(patch) {
  const before = state.account;
  state = { ...state, ...patch };
  if (state.account !== before) accountListeners.forEach((fn) => fn(state.account));
  listeners.forEach((fn) => fn());
}

/** Hear sign-in and sign-out (before React redraws); returns an unsubscribe. */
export function onAccountChange(fn) {
  accountListeners.add(fn);
  return () => accountListeners.delete(fn);
}

export function useAuth() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
}
export const currentAccount = () => state.account;

export async function call(path, init) {
  const res = await fetch(API + path, { cache: "no-store", ...init });
  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || "Sign-in is unavailable right now."), { status: res.status });
  return data;
}
export const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---- Google Identity Services -------------------------------------------------
let clientId = null;
let gsi = null;
function loadGsi() {
  if (!gsi) {
    gsi = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GSI;
      s.async = true;
      s.onload = () => {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (r) => onCredential(r.credential),
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
        });
        resolve(window.google.accounts.id);
      };
      s.onerror = () => { gsi = null; reject(new Error("Google sign-in could not load.")); };
      document.head.appendChild(s);
    });
  }
  return gsi;
}

const systemDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
export const buttonTheme = () => ((document.documentElement.dataset.theme || (systemDark && systemDark.matches ? "dark" : "light")) === "dark" ? "outline_dark" : "outline");

/** Subscribe to the theme Google's button should follow; returns an unsubscribe. */
export function onButtonThemeChange(fn) {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  systemDark && systemDark.addEventListener("change", fn);
  return () => { mo.disconnect(); systemDark && systemDark.removeEventListener("change", fn); };
}

/** Draw Google's button into `el`. Resolves once drawn; rejects if GIS cannot load. */
export async function renderGoogleButton(el, options) {
  const id = await loadGsi();
  if (!el.isConnected) return;
  el.innerHTML = "";
  id.renderButton(el, { theme: buttonTheme(), size: "large", text: "signin_with", shape: "rectangular", logo_alignment: "left", ...options });
}

// ---- signing in and out -------------------------------------------------------
let signingIn = false;
async function onCredential(credential) {
  if (signingIn) return;
  signingIn = true;
  try {
    const r = await call("/auth/google", json("POST", {
      credential,
      visitor: visitorId(),
      seen: seenStore.all(),
      filters: presets.all(),
      saved: savedItems(),
    }));
    applySync(r.sync);
    signedIn(r.account);
  } catch (err) {
    set({ error: err.message || "Sign-in failed. Please try again." });
    dispatchEvent(new CustomEvent("auth-error", { detail: err.message }));
  } finally {
    signingIn = false;
  }
}

function signedIn(account) {
  if (account && account.name) adoptName(account.name);
  set({ account, signInOpen: account ? false : state.signInOpen, error: "" });
}

export async function signOut() {
  try { await call("/auth/logout", json("POST", {})); } catch { /* the cookie is cleared either way */ }
  try { if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect(); } catch { /* fine */ }
  set({ account: null });
}

/** Sign-in is asked for only once the visitor chooses to upload a resume. */
export function requestResumeSignIn() {
  if (state.account) return;
  set({ signInOpen: true, error: "" });
}
export const closeResumeSignIn = () => set({ signInOpen: false, error: "" });

// ---- keeping the account in step ---------------------------------------------
let syncingIn = false;
function applySync(sync) {
  if (!sync) return;
  syncingIn = true;
  try {
    if (sync.seen) seenStore.merge(sync.seen);
    if (Array.isArray(sync.filters)) presets.replaceAll(sync.filters);
    if (Array.isArray(sync.saved)) saved.replaceAll(sync.saved);
  } finally {
    syncingIn = false;
  }
}

if (typeof window !== "undefined") {
  // Opened jobs go up in small batches: a burst of clicks is one request.
  let seenBatch = {};
  let seenTimer = null;
  addEventListener("seen-change", (e) => {
    if (!state.account || syncingIn || !e.detail) return;
    seenBatch[e.detail.id] = e.detail.ts;
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      const seen = seenBatch;
      seenBatch = {};
      call("/sync/seen", json("POST", { seen })).catch(() => { /* the next page load reconciles */ });
    }, 1500);
  });

  let savedTimer = null;
  addEventListener("saved-change", () => {
    if (!state.account || syncingIn) return;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { call("/sync/saved", json("PUT", { items: savedItems() })).catch(() => {}); }, 600);
  });

  let filterTimer = null;
  addEventListener("presets-change", () => {
    if (!state.account || syncingIn) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { call("/sync/filters", json("PUT", { items: presets.all() })).catch(() => {}); }, 600);
  });
}

// ---- start ------------------------------------------------------------------
export const authReady = (async () => {
  let account = null;
  try {
    clientId = (await call("/auth/config")).clientId;
    account = (await call("/auth/me")).account;
  } catch {
    // A static host has no /api/auth: sign-in is simply not offered.
    clientId = null;
  }
  if (account) {
    try {
      const sync = await call("/sync");
      applySync(sync);
      // First load after this browser saved filters or jobs while the account had none.
      if (sync.filters === null && presets.all().length) call("/sync/filters", json("PUT", { items: presets.all() })).catch(() => {});
      if (sync.saved === null && savedItems().length) call("/sync/saved", json("PUT", { items: savedItems() })).catch(() => {});
    } catch { /* history sync is a convenience; the page works without it */ }
  }
  set({ ready: true, enabled: !!clientId });
  signedIn(account);
  return account;
})();
