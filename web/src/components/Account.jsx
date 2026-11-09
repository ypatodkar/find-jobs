// Google's sign-in button, the account menu in the header, and the popup that asks for
// sign-in before a resume upload.
import { useEffect, useRef, useState } from "react";
import { LogOutIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { closeResumeSignIn, onButtonThemeChange, renderGoogleButton, signOut, useAuth } from "../lib/auth.js";
import { Tip } from "./HeaderExtras.jsx";

/**
 * Google's own button, drawn by GIS into a host element and redrawn when the theme changes.
 * `quiet`: when GIS cannot load (a blocker, a strict browser), draw nothing rather than
 * the reason. The header has no room for a sentence, and the sign-in popup, which
 * isn't quiet, says why at the moment it matters.
 */
export function GoogleButton({ className = "", options, id, quiet = false }) {
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

  // GSI's iframe uses a light canvas even for its dark button. Keeping the embedding
  // scheme light stops its transparent margins painting a white rectangle in dark mode.
  const cls = cn(className, "google-signin scheme-only-light");
  const off = "auth-off text-sm text-muted-foreground";
  if (!enabled) return <div className={cls} id={id}><p className={off}>Sign-in isn't set up on this server yet.</p></div>;
  if (failed) return quiet ? null : <div className={cls} id={id}><p className={off}>{failed}</p></div>;
  return <div ref={host} className={cls} id={id}></div>;
}

/** The signed-in face: the account's picture, or its initial when there is none or it will not load. */
function Face({ account, className }) {
  const initial = (account.name || account.email || "?").trim().charAt(0).toUpperCase();
  return (
    <Avatar className={className}>
      {account.picture ? <AvatarImage src={account.picture} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="text-xs font-medium text-foreground">{initial}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The header's #account-slot. Signed out: Google's round icon button, in a box the size
 * of the header's other icon buttons. Signed in: the face, opening a menu with the
 * account and Sign out. Without sign-in on this server (a static host), or when
 * Google's script cannot load, nothing.
 */
export function AccountSlot() {
  const { enabled, account } = useAuth();

  let body = null;
  if (enabled && !account) {
    body = (
      <GoogleButton quiet className="account-signin flex min-h-8 min-w-8 items-center justify-center"
        id="account-signin" options={{ type: "icon", shape: "circle", size: "medium" }} />
    );
  } else if (enabled && account) {
    body = (
      <DropdownMenu>
        <Tip label={account.email}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="account-face rounded-full" aria-label={`Account: ${account.email}`}>
              <Face account={account} className="size-7" />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" collisionPadding={16} className="account-panel w-72">
          <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
            <Face account={account} className="size-9" />
            <span className="flex min-w-0 flex-col">
              <span className="account-name truncate text-sm font-medium text-foreground">{account.name || "Signed in"}</span>
              <span className="account-email text-xs break-all text-muted-foreground">{account.email}</span>
            </span>
          </DropdownMenuLabel>
          <p className="account-note px-2 pb-2 text-xs leading-relaxed text-muted-foreground">
            Your resumes, scores, saved jobs, opened jobs and saved filters are kept on this account.
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="account-signout" id="account-signout" onSelect={signOut}>
            <LogOutIcon aria-hidden="true" />Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return <div id="account-slot" className="flex items-center empty:hidden">{body}</div>;
}

/**
 * The modal that asks for sign-in once someone chooses to add a resume. Radix's dialog
 * owns Tab and Escape, and it sits above everything, the phone's job sheet included:
 * its keys stop here, so Escape closes the popup without closing the sheet under it.
 * Closing (the button, Escape, a click outside, signing in) hands focus back to what
 * opened it, the Upload button.
 */
export function ResumeSignInDialog() {
  const { signInOpen, error } = useAuth();
  const opener = useRef(null);

  return (
    <Dialog open={signInOpen} onOpenChange={(open) => { if (!open) closeResumeSignIn(); }}>
      <DialogContent showCloseButton={false} className="resume-signin-dialog gap-5 sm:max-w-[420px]"
        aria-labelledby="resume-signin-title" aria-describedby="resume-signin-description"
        onKeyDown={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          opener.current = document.activeElement;
          e.preventDefault();
          e.currentTarget.querySelector(".resume-signin-close")?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const back = opener.current;
          opener.current = null;
          if (back && back.isConnected) back.focus();
        }}>
        <Button type="button" variant="ghost" size="icon-sm" className="resume-signin-close absolute top-3 right-3 text-muted-foreground"
          aria-label="Close sign-in popup" onClick={closeResumeSignIn}>
          <XIcon />
        </Button>
        <DialogHeader>
          <DialogTitle id="resume-signin-title" className="pr-8 text-lg font-semibold">Sign in to upload your resume</DialogTitle>
          <p id="resume-signin-description" className="text-sm leading-relaxed text-muted-foreground">
            Sign in with Google to save your resume and analyze how it matches this job.
          </p>
        </DialogHeader>
        <GoogleButton className="match-signin min-h-10" options={{ size: "large", text: "continue_with" }} />
        <Alert variant="destructive" className="resume-signin-error" role="alert" hidden={!error}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  );
}
