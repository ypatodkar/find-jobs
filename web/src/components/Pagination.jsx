// Page controls under the list: Previous / Next, page numbers in blocks of ten, a
// "Page X of Y" status for screen readers (shown on phones, where it sits between
// Previous and Next), and a compact "Go to page" box on the right.
//
// Drawn with shadcn's Pagination look, but every control is a button that calls
// `onPage`: the page lives in the address bar (lib/useFilterState.js), which owns the
// history entry, so these are not links.
import { useState, useEffect } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LABEL = "Job result pages";

export default function Pagination({ page, pageCount, onPage }) {
  const [typed, setTyped] = useState(String(page));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setTyped(String(page)); setInvalid(false); }, [page]);
  if (pageCount <= 1) return <nav id="job-pagination" className="pagination" aria-label={LABEL} hidden />;

  const first = Math.floor((page - 1) / 10) * 10 + 1;
  const last = Math.min(first + 9, pageCount);
  const numbers = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const jump = (e) => {
    e.preventDefault();
    const n = Number(typed);
    if (!Number.isInteger(n) || n < 1 || n > pageCount) { setInvalid(true); return; }
    onPage(n);
  };

  // Phones: the numbers take the first two lines, five to a line as before the
  // redesign (ten in one line would leave "10" alone on a 360-375px phone), then
  // Previous · status · Next, then the jump box. From 640px: one line, the jump box
  // pushed to the right.
  return (
    <nav id="job-pagination" aria-label={LABEL}
      className="pagination mt-6 flex flex-wrap items-center justify-between gap-x-1 gap-y-3 border-t pt-4 sm:justify-start">
      <Button type="button" variant="ghost" size="sm" className="page-prev order-2 sm:order-none" disabled={page === 1} onClick={() => onPage(page - 1)}>
        <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />Previous
      </Button>
      <span className="page-numbers order-1 grid w-full grid-cols-5 justify-items-center gap-1 sm:order-none sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center" role="group" aria-label="Choose a results page">
        {numbers.map((n) => (
          <Button key={n} type="button" variant={n === page ? "outline" : "ghost"} size="icon-sm" className="page-number tabular" aria-label={`Page ${n}`}
            aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>{n}</Button>
        ))}
      </span>
      <span className="page-status tabular order-2 text-sm text-muted-foreground sm:sr-only" role="status" aria-live="polite" aria-atomic="true">Page {page} of {pageCount}</span>
      <Button type="button" variant="ghost" size="sm" className="page-next order-2 sm:order-none" disabled={page === pageCount} onClick={() => onPage(page + 1)}>
        Next<ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
      </Button>
      <form className="page-jump order-3 flex w-full items-center justify-center gap-2 text-sm whitespace-nowrap text-muted-foreground sm:order-none sm:ml-auto sm:w-auto" noValidate onSubmit={jump}>
        <label htmlFor="page-input">Go to page</label>
        <Input id="page-input" className="page-input tabular h-8 w-16 [appearance:textfield] text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          type="number" min="1" max={pageCount} step="1" inputMode="numeric"
          autoComplete="off" aria-label={`Go to page, 1 to ${pageCount}`} aria-invalid={invalid || undefined}
          value={typed} onChange={(e) => { setTyped(e.target.value); setInvalid(false); }} />
        <span className="page-total tabular">of {pageCount}</span>
        <Button type="submit" variant="outline" size="sm" className="page-go">Go</Button>
      </form>
    </nav>
  );
}
