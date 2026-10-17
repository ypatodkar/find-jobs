// Page controls: Previous / Next, page numbers in blocks
// of ten, a status line for screen readers, and a "Go to page" box.
import { useState, useEffect } from "react";

export default function Pagination({ page, pageCount, onPage }) {
  const [typed, setTyped] = useState(String(page));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setTyped(String(page)); setInvalid(false); }, [page]);
  if (pageCount <= 1) return <nav id="job-pagination" className="pagination" aria-label="Job result pages" hidden />;

  const first = Math.floor((page - 1) / 10) * 10 + 1;
  const last = Math.min(first + 9, pageCount);
  const numbers = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const jump = (e) => {
    e.preventDefault();
    const n = Number(typed);
    if (!Number.isInteger(n) || n < 1 || n > pageCount) { setInvalid(true); return; }
    onPage(n);
  };

  return (
    <nav id="job-pagination" className="pagination" aria-label="Job result pages">
      <button type="button" className="page-prev" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="page-numbers" role="group" aria-label="Choose a results page">
        {numbers.map((n) => (
          <button key={n} type="button" className="page-number" aria-label={`Page ${n}`}
            aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>
        ))}
      </span>
      <span className="page-status" role="status" aria-live="polite" aria-atomic="true">Page {page} of {pageCount}</span>
      <button type="button" className="page-next" disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next</button>
      <form className="page-jump" noValidate onSubmit={jump}>
        <label htmlFor="page-input">Go to page</label>
        <input id="page-input" className="page-input" type="number" min="1" max={pageCount} step="1" inputMode="numeric"
          autoComplete="off" aria-label={`Go to page, 1 to ${pageCount}`} aria-invalid={invalid || undefined}
          value={typed} onChange={(e) => { setTyped(e.target.value); setInvalid(false); }} />
        <span className="page-total">of {pageCount}</span>
        <button type="submit" className="page-go">Go</button>
      </form>
    </nav>
  );
}
