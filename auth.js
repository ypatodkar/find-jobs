// Google sign-in, and keeping a signed-in account in step with this browser.
//
// The button and the token come from Google Identity Services. The token goes to
// POST api/auth/google, which verifies it and answers with a session cookie the page
// cannot read (HttpOnly) — so nothing here ever holds a credential.
//
// Signing in sends what this browser already had (opened jobs, saved filters) along
// with the token, and the account's merged copy comes back. While signed in, each
// newly opened job and every saved-filter change is copied to the account, and a page
// load pulls the account's copy, so another device's history shows up here.
//
// Exposes window.Auth: ready, account(), enabled(), onChange(fn), renderButton(el),
// signOut().
(function (global) {
  "use strict";

  const API = (global.AUTH_API || "api").replace(/\/$/, "");
  const GSI = "https://accounts.google.com/gsi/client";

  let clientId = null;
  let account = null;
  const listeners = [];
  const notify = () => listeners.forEach((fn) => { try { fn(account); } catch (e) { console.error(e); } });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function call(path, init) {
    const res = await fetch(API + path, { cache: "no-store", ...init });
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || "Sign-in is unavailable right now."), { status: res.status });
    return data;
  }
  const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // ---- Google Identity Services -------------------------------------------------
  let gsi = null;
  function loadGsi() {
    if (!gsi) {
      gsi = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = GSI;
        s.async = true;
        s.onload = () => {
          global.google.accounts.id.initialize({
            client_id: clientId,
            callback: (r) => onCredential(r.credential),
            ux_mode: "popup",
            auto_select: false,
            cancel_on_tap_outside: true,
            itp_support: true,
          });
          resolve(global.google.accounts.id);
        };
        s.onerror = () => { gsi = null; reject(new Error("Google sign-in could not load.")); };
        document.head.appendChild(s);
      });
    }
    return gsi;
  }

  const pending = []; // containers waiting for a button
  function renderButton(el, options) {
    if (!el) return;
    if (!clientId) {
      el.innerHTML = `<p class="auth-off">Sign-in isn't set up on this server yet.</p>`;
      return;
    }
    loadGsi().then((id) => {
      if (!el.isConnected) return;
      el.innerHTML = "";
      id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", logo_alignment: "left", ...options });
    }).catch((err) => { el.innerHTML = `<p class="auth-off">${esc(err.message)}</p>`; });
  }

  // ---- signing in and out -------------------------------------------------------
  let signingIn = null;
  async function onCredential(credential) {
    if (signingIn) return;
    signingIn = (async () => {
      try {
        const r = await call("/auth/google", json("POST", {
          credential,
          visitor: global.Visitor ? global.Visitor.id() : null,
          seen: global.Seen ? global.Seen.all() : {},
          filters: global.Presets ? global.Presets.all() : [],
          saved: global.Saved ? global.Saved.all() : [],
        }));
        account = r.account;
        applySync(r.sync);
        notify();
      } catch (err) {
        global.dispatchEvent(new CustomEvent("auth-error", { detail: err.message }));
      } finally {
        signingIn = null;
      }
    })();
  }

  async function signOut() {
    try { await call("/auth/logout", json("POST", {})); } catch { /* the cookie is cleared either way */ }
    try { if (global.google && global.google.accounts) global.google.accounts.id.disableAutoSelect(); } catch { /* fine */ }
    account = null;
    notify();
  }

  // ---- keeping the account in step ---------------------------------------------
  let syncingIn = false;
  function applySync(sync) {
    if (!sync) return;
    syncingIn = true;
    try {
      if (global.Seen && sync.seen) global.Seen.merge(sync.seen);
      if (global.Presets && Array.isArray(sync.filters)) global.Presets.replaceAll(sync.filters);
      if (global.Saved && Array.isArray(sync.saved)) global.Saved.replaceAll(sync.saved);
    } finally {
      syncingIn = false;
    }
  }

  // Opened jobs go up in small batches: a burst of clicks is one request.
  let seenBatch = {};
  let seenTimer = null;
  global.addEventListener("seen-change", (e) => {
    if (!account || syncingIn || !e.detail) return;
    seenBatch[e.detail.id] = e.detail.ts;
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      const seen = seenBatch;
      seenBatch = {};
      call("/sync/seen", json("POST", { seen })).catch(() => { /* the next page load reconciles */ });
    }, 1500);
  });

  let savedTimer = null;
  global.addEventListener("saved-change", () => {
    if (!account || syncingIn || !global.Saved) return;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      call("/sync/saved", json("PUT", { items: global.Saved.all() })).catch(() => {});
    }, 600);
  });

  let filterTimer = null;
  global.addEventListener("presets-change", () => {
    if (!account || syncingIn || !global.Presets) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      call("/sync/filters", json("PUT", { items: global.Presets.all() })).catch(() => {});
    }, 600);
  });

  // ---- header ------------------------------------------------------------------
  function renderHeader() {
    const slot = document.getElementById("account-slot");
    if (!slot) return;
    if (!clientId) { slot.innerHTML = ""; return; }
    if (!account) {
      slot.innerHTML = `<div class="account-signin" id="account-signin"></div>`;
      renderButton(document.getElementById("account-signin"), { type: "icon", shape: "circle", size: "medium" });
      return;
    }
    const initial = (account.name || account.email || "?").trim().charAt(0).toUpperCase();
    const face = account.picture
      ? `<img src="${esc(account.picture)}" alt="" referrerpolicy="no-referrer" width="32" height="32">`
      : esc(initial);
    slot.innerHTML = `
      <details class="account-menu">
        <summary class="account-face" aria-label="Account: ${esc(account.email)}" title="${esc(account.email)}">${face}</summary>
        <div class="account-panel">
          <p class="account-name">${esc(account.name || "Signed in")}</p>
          <p class="account-email">${esc(account.email)}</p>
          <p class="account-note">Your resumes, scores, saved jobs, opened jobs and saved filters are kept on this account.</p>
          <button type="button" class="account-signout" id="account-signout">Sign out</button>
        </div>
      </details>`;
    document.getElementById("account-signout").addEventListener("click", signOut);
    // A picture that will not load falls back to the initial.
    const img = slot.querySelector(".account-face img");
    if (img) img.addEventListener("error", () => { img.replaceWith(document.createTextNode(initial)); });
  }
  document.addEventListener("click", (e) => {
    const m = document.querySelector(".account-menu[open]");
    if (m && !m.contains(e.target)) m.open = false;
  });
  listeners.push(renderHeader);
  listeners.push((a) => { if (a && a.name && global.Visitor && global.Visitor.adopt) global.Visitor.adopt(a.name); });

  // ---- start ------------------------------------------------------------------
  const ready = (async () => {
    try {
      clientId = (await call("/auth/config")).clientId;
      account = (await call("/auth/me")).account;
    } catch {
      // A static host has no /api/auth: sign-in is simply not offered.
      clientId = null;
      account = null;
    }
    if (account) {
      try {
        const sync = await call("/sync");
        applySync(sync);
        // First load after this browser saved filters while the account had none.
        if (sync.filters === null && global.Presets && global.Presets.count()) {
          call("/sync/filters", json("PUT", { items: global.Presets.all() })).catch(() => {});
        }
        if (sync.saved === null && global.Saved && global.Saved.count()) {
          call("/sync/saved", json("PUT", { items: global.Saved.all() })).catch(() => {});
        }
      } catch { /* history sync is a convenience; the page works without it */ }
    }
    notify(); // header, the resume card, and the greeting all key off this
    return account;
  })();

  global.Auth = {
    ready,
    account: () => account,
    enabled: () => !!clientId,
    onChange: (fn) => listeners.push(fn),
    renderButton,
    signOut,
  };
})(window);
