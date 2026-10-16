// This browser's anonymous id (localStorage "vc-directory-visitor", { id, name, asked }),
// attached to clicks, likes, feedback and saved-filter reports. Minted on first use.
const KEY = "vc-directory-visitor";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === "object" && typeof raw.id === "string" ? raw : null;
  } catch {
    return null;
  }
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function ensure() {
  let me = read();
  if (!me) {
    me = { id: uuid(), name: null, asked: false };
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch { /* private mode: id lasts the visit */ }
  }
  return me;
}

export const visitorId = () => ensure().id;
export const visitorName = () => (read() || {}).name || null;

/** Take a signed-in account's first name, unless this browser already has one. */
export function adoptName(name) {
  const me = ensure();
  const v = String(name || "").split(/\s+/)[0].trim().slice(0, 32);
  if (me.name || !v) return;
  try { localStorage.setItem(KEY, JSON.stringify({ ...me, name: v, asked: true })); } catch { /* fine */ }
}
