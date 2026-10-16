// Google's sign-in button, the account menu in the header, and the popup that asks for
// sign-in before a resume upload. Markup as auth.js renderButton, renderHeader and
// requestResumeSignIn.
import { useEffect, useRef, useState } from "react";
import { closeResumeSignIn, onButtonThemeChange, renderGoogleButton, signOut, useAuth } from "../lib/auth.js";

/** Google's own button, drawn by GIS into a host element and redrawn when the theme changes. */
export function GoogleButton({ className = "", options, id }) {
  const host = useRef(null);
  const { enabled } = useAuth();
  const [failed, setFailed] = useState("");
  const key = JSON.stringify(options || {});

  useEffect(() => {
    if (!enabled || !host.current) return;
    const el = host.current;
    const draw = () => renderGoogleButton(el, options).then(() => setFailed(""), (err) => setFailed(err.message));
    draw();
    return onButtonThemeChange(draw);
  }, [enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const cls = `${className} google-signin`.trim();
  if (!enabled) return <div className={cls} id={id}><p className="auth-off">Sign-in isn't set up on this server yet.</p></div>;
  if (failed) return <div className={cls} id={id}><p className="auth-off">{failed}</p></div>;
  return <div ref={host} className={cls} id={id}></div>;
}

function Face({ account }) {
  const initial = (account.name || account.email || "?").trim().charAt(0).toUpperCase();
  const [broken, setBroken] = useState(false);
  // A picture that will not load falls back to the initial.
  return account.picture && !broken
    ? <img src={account.picture} alt="" referrerPolicy="no-referrer" width="32" height="32" onError={() => setBroken(true)} />
    : initial;
}

/** The header's #account-slot: Google's round icon button, or the signed-in face and menu. */
export function AccountSlot() {
  const { enabled, account } = useAuth();
  const menu = useRef(null);

  useEffect(() => {
    const close = (e) => { const m = menu.current; if (m && m.open && !m.contains(e.target)) m.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  let body = null;
  if (enabled && !account) body = <GoogleButton className="account-signin" id="account-signin" options={{ type: "icon", shape: "circle", size: "medium" }} />;
  else if (enabled && account) {
    body = (
      <details className="account-menu" ref={menu}>
        <summary className="account-face" aria-label={`Account: ${account.email}`} title={account.email}><Face account={account} /></summary>
        <div className="account-panel">
          <p className="account-name">{account.name || "Signed in"}</p>
          <p className="account-email">{account.email}</p>
          <p className="account-note">Your resumes, scores, saved jobs, opened jobs and saved filters are kept on this account.</p>
          <button type="button" className="account-signout" id="account-signout" onClick={signOut}>Sign out</button>
        </div>
      </details>
    );
  }
  return <div id="account-slot">{body}</div>;
}

/** The modal that asks for sign-in once someone chooses to add a resume. */
export function ResumeSignInDialog() {
  const { signInOpen, error } = useAuth();
  const dialog = useRef(null);

  useEffect(() => {
    const d = dialog.current;
    if (signInOpen && d && !d.open) d.showModal();
    if (!signInOpen && d && d.open) d.close();
  }, [signInOpen]);

  if (!signInOpen) return null;
  const outside = (e) => {
    if (e.target !== dialog.current) return;
    const b = dialog.current.getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dialog.current.close();
  };
  return (
    // The native modal owns Tab and Escape, including above the mobile job sheet.
    <dialog ref={dialog} className="resume-signin-dialog" aria-labelledby="resume-signin-title" aria-describedby="resume-signin-description"
      onClick={outside} onKeyDown={(e) => e.stopPropagation()} onClose={closeResumeSignIn}>
      <button type="button" className="resume-signin-close" aria-label="Close sign-in popup" autoFocus onClick={() => dialog.current.close()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
      <h2 id="resume-signin-title">Sign in to upload your resume</h2>
      <p id="resume-signin-description">Sign in with Google to save your resume and analyze how it matches this job.</p>
      <GoogleButton className="match-signin" options={{ size: "large", text: "continue_with" }} />
      <p className="resume-signin-error" role="alert" hidden={!error}>{error}</p>
    </dialog>
  );
}
