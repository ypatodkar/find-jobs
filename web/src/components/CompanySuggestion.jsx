import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { call, json } from "../lib/auth.js";
import { visitorId, visitorName } from "../lib/visitor.js";

// Keep the return state on this job-list history entry, alongside filters and pagination.
function rememberSuggestion(draft) {
  const state = { ...history.state };
  if (draft) state.companySuggestion = draft;
  else if (state.companySuggestion) delete state.companySuggestion;
  else return;
  history.replaceState(state, "");
}

export default function CompanySuggestion({ firm = null, view = null, country }) {
  const panelId = useId();
  const trigger = useRef(null);
  const input = useRef(null);
  const restored = history.state?.companySuggestion;
  const lastAttempt = useRef(restored?.attempt || null);
  const [open, setOpen] = useState(() => Boolean(restored));
  const [message, setMessage] = useState(() => restored?.message || "");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  async function submit(event) {
    event.preventDefault();
    if (status === "saving") return;
    if (!message.trim()) {
      setError("Enter a company name, a link, or a short suggestion.");
      input.current.focus();
      return;
    }
    if (lastAttempt.current?.message !== message) lastAttempt.current = { message, id: crypto.randomUUID() };
    setStatus("saving");
    setError("");
    try {
      const result = await call("/company-suggestions", {
        ...json("POST", {
          message, id: lastAttempt.current.id, visitor_id: visitorId(), visitor_name: visitorName(),
          page: location.pathname, firm, list_country: country, list_view: view,
          locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!result?.saved) throw new Error();
      rememberSuggestion(null);
      lastAttempt.current = null;
      setMessage("");
      setOpen(false);
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
          if (open) rememberSuggestion(null);
          setOpen(!open); setStatus("idle"); setError("");
        }}
        className="border-[#A5B79F] bg-[#E2EBDD] text-[#304C36] hover:bg-[#D2E1CC] focus-visible:ring-[#648269] dark:border-[#586F56] dark:bg-[#2B3C2D] dark:text-[#DBEAD4] dark:hover:bg-[#364C39]">
        Suggest a company
      </Button>
      <div id={panelId} hidden={!open && status !== "saved"} className="order-last w-full min-w-0 text-left">
        {open && <form onSubmit={submit} className="grid gap-2 rounded-lg border bg-card p-3">
          <label htmlFor={panelId + "-message"} className="text-sm font-medium">Which company’s jobs would you like to see?</label>
          <Textarea id={panelId + "-message"} ref={input} value={message} readOnly={status === "saving"}
            onChange={(e) => { setMessage(e.target.value); setError(""); }}
            rows={2} maxLength={4096} placeholder="Enter a company name, website, or careers link. You can add a note too." />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href="about.html" onClick={() => rememberSuggestion({ message, attempt: lastAttempt.current })}
              className="text-xs text-muted-foreground underline">How your data is used</a>
            <Button type="submit" size="sm" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Send suggestion"}</Button>
          </div>
        </form>}
        <p role="status" className="text-sm text-muted-foreground">{status === "saved" && "Thanks! Your suggestion was saved."}</p>
      </div>
    </>
  );
}
