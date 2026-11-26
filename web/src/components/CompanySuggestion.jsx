import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { call, json } from "../lib/auth.js";
import { visitorId, visitorName } from "../lib/visitor.js";

// A draft lasts for this tab and list. Writing to session storage avoids changing
// browser history on every keystroke and lets a retry reuse its original request ID.
function readDraft(key, fallback = null) {
  try { return JSON.parse(sessionStorage.getItem(key)); }
  catch { return fallback; }
}

export default function CompanySuggestion({ firm = null, view = null, country }) {
  const panelId = useId();
  const trigger = useRef(null);
  const input = useRef(null);
  const storageKey = `find-jobs:suggestion:${country}:${firm || ""}`;
  const [draft, setDraft] = useState(() => readDraft(storageKey));
  const open = draft !== null;
  const message = draft?.message || "";
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  useEffect(() => {
    // Another Jobs document in this tab may have edited or cleared the same draft.
    function restore(event) {
      if (event.persisted) setDraft(current => readDraft(storageKey, current));
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [storageKey]);

  function saveDraft(next) {
    setDraft(next);
    try {
      if (next === null) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch { /* Keep the form usable when browser storage is unavailable. */ }
  }

  async function submit(event) {
    event.preventDefault();
    if (status === "saving") return;
    if (!message.trim()) {
      setError("Enter a company name, a link, or a short suggestion.");
      input.current.focus();
      return;
    }
    const id = draft.id || crypto.randomUUID();
    saveDraft({ message, id });
    setStatus("saving");
    setError("");
    try {
      const result = await call("/company-suggestions", {
        ...json("POST", {
          message, id, visitor_id: visitorId(), visitor_name: visitorName(),
          page: location.pathname, firm, list_country: country, list_view: view,
          locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!result?.saved) throw new Error();
      saveDraft(null);
      setStatus("saved");
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (err) {
      setError(err.status === 400 ? err.message : "We couldn’t confirm your suggestion was saved. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <>
      <Button ref={trigger} type="button" variant="secondary" size="sm" aria-expanded={open} aria-controls={panelId}
        disabled={status === "saving"} onClick={() => {
          saveDraft(open ? null : { message: "" });
          setStatus("idle"); setError("");
        }}
        className="border-[#A5B79F] bg-[#E2EBDD] text-[#304C36] hover:bg-[#D2E1CC] focus-visible:ring-[#648269] dark:border-[#586F56] dark:bg-[#2B3C2D] dark:text-[#DBEAD4] dark:hover:bg-[#364C39]">
        Suggest a company
      </Button>
      <div id={panelId} hidden={!open && status !== "saved"} className="order-last w-full min-w-0 text-left">
        {open && <form onSubmit={submit} className="grid gap-2 rounded-lg border bg-card p-3">
          <label htmlFor={panelId + "-message"} className="text-sm font-medium">Which company’s jobs would you like to see?</label>
          <Textarea id={panelId + "-message"} ref={input} value={message} readOnly={status === "saving"}
            onChange={(e) => { saveDraft({ message: e.target.value }); setError(""); }}
            rows={2} maxLength={4096} placeholder="Enter a company name, website, or careers link. You can add a note too." />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href="about.html" className="text-xs text-muted-foreground underline">How your data is used</a>
            <Button type="submit" size="sm" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Send suggestion"}</Button>
          </div>
        </form>}
        <p role="status" className="text-sm text-muted-foreground">{status === "saved" && "Thanks! Your suggestion was saved."}</p>
      </div>
    </>
  );
}
