import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { call, json } from "../lib/auth.js";
import { visitorId, visitorName } from "../lib/visitor.js";

export default function CompanySuggestion({ firm = null, view = null, country }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const lastAttempt = useRef(null);

  async function submit(event) {
    event.preventDefault();
    if (status === "saving") return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (!fields.company_name.trim() && !fields.submitted_url.trim()) {
      setError("Enter a company name or a link.");
      event.currentTarget.elements.company_name.focus();
      return;
    }
    const draft = JSON.stringify(fields);
    if (lastAttempt.current?.draft !== draft) lastAttempt.current = { draft, id: crypto.randomUUID() };
    setStatus("saving");
    setError("");
    try {
      const result = await call("/company-suggestions", {
        ...json("POST", {
          ...fields, id: lastAttempt.current.id, visitor_id: visitorId(), visitor_name: visitorName(),
          page: location.pathname, firm, list_country: country, list_view: view,
          locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!result?.saved) throw new Error();
      lastAttempt.current = null;
      setStatus("saved");
    } catch (err) {
      setError(err.status === 400 ? err.message : "We couldn’t confirm your suggestion was saved. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (status === "saving") return;
      setOpen(next);
      if (next) { setStatus("idle"); setError(""); }
    }}>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="px-0">Suggest a company</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={status !== "saving"} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{status === "saved" ? "Suggestion saved" : "Suggest a company"}</DialogTitle>
          <DialogDescription>{status === "saved" ? "Thanks! I’ll review the company for the job list."
            : "Which company’s jobs would you like to see? A name or a link is enough."}</DialogDescription>
        </DialogHeader>
        {status === "saved" ? <DialogFooter><DialogClose asChild><Button>Done</Button></DialogClose></DialogFooter> : (
          <form className="grid gap-4" onSubmit={submit}>
            <fieldset className="grid min-w-0 gap-4" disabled={status === "saving"}>
              <label className="grid gap-1.5 text-sm">Company name<Input name="company_name" maxLength={200} /></label>
              <label className="grid gap-1.5 text-sm">Website, careers page, or job link
                <Input name="submitted_url" inputMode="url" maxLength={2048} autoCapitalize="none" spellCheck={false} />
              </label>
              <label className="grid gap-1.5 text-sm">Notes (optional)<Textarea name="notes" rows={2} maxLength={2000} /></label>
            </fieldset>
            <p className="text-xs text-muted-foreground">Saved with your browser details, approximate country when available, and account if signed in.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline" disabled={status === "saving"}>Cancel</Button></DialogClose>
              <Button type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Send suggestion"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
