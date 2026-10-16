// Filter state, its undo history, and the address bar, as in jobs-ui.js:
//
//   - The URL describes the view, so a filtered list survives a reload and can be
//     shared. Filters and sort replace the current history entry (refining one view);
//     page and tab push one (navigation), so Back steps through those.
//   - Undo steps back through filter changes; a burst of typing in the search box is
//     one step, not one per key. Arriving via Back is not a change to undo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyFilters, normalize, sameFilters, stateToSearch, urlToState } from "./filters.js";

const HISTORY_MAX = 25;
const COALESCE_MS = 1200;

const onlyQueryChanged = (a, b) => !!a && !!b && a.query !== b.query && sameFilters({ ...a, query: "" }, { ...b, query: "" });

export function useFilterState(dims) {
  const initial = useMemo(() => urlToState(location.search, dims), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFiltersState] = useState(() => normalize(initial.filters));
  const [page, setPageState] = useState(initial.page);
  const [view, setViewState] = useState(initial.view);
  const [canUndo, setCanUndo] = useState(false);

  const current = useRef(filters);
  current.current = filters;
  const undoStack = useRef([]);
  const lastPushAt = useRef(0);
  const pushNext = useRef(false);  // the next address-bar write is navigation
  const fromUrl = useRef(true);    // the state just came from the URL: do not write it back

  const setFilters = useCallback((next) => {
    const prev = current.current;
    next = normalize(next);
    if (sameFilters(prev, next)) return;
    const stack = undoStack.current;
    const t = Date.now();
    const coalesce = stack.length && onlyQueryChanged(prev, next) && onlyQueryChanged(stack[stack.length - 1], prev) && t - lastPushAt.current < COALESCE_MS;
    if (!coalesce) {
      stack.push(prev);
      if (stack.length > HISTORY_MAX) stack.shift();
      lastPushAt.current = t;
    }
    setCanUndo(stack.length > 0);
    setFiltersState(next);
    setPageState(1);
  }, []);

  const undo = useCallback(() => {
    const target = undoStack.current.pop();
    if (!target) return;
    setCanUndo(undoStack.current.length > 0);
    setFiltersState(target);
    setPageState(1);
  }, []);

  // Reset clears every filter and the search, and keeps the chosen order.
  const reset = useCallback(() => setFilters({ ...emptyFilters(), sort: current.current.sort }), [setFilters]);

  const setPage = useCallback((n) => { pushNext.current = true; setPageState(n); }, []);
  const setView = useCallback((v) => { pushNext.current = true; setViewState(v); setPageState(1); }, []);

  // Write the view to the address bar after every change that did not come from it.
  useEffect(() => {
    if (fromUrl.current) { fromUrl.current = false; return; }
    const url = location.pathname + stateToSearch(location.search, dims, filters, page, view) + location.hash;
    if (url === location.pathname + location.search + location.hash) return;
    if (pushNext.current) history.pushState({ page }, "", url);
    else history.replaceState({ ...history.state, page }, "", url);
    pushNext.current = false;
  }, [filters, page, view, dims]);

  // Back and Forward bring the view the URL describes.
  useEffect(() => {
    const onPop = () => {
      const s = urlToState(location.search, dims);
      fromUrl.current = true;
      setFiltersState(normalize(s.filters));
      setPageState(s.page);
      setViewState(s.view);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [dims]);

  return { filters, setFilters, page, setPage, view, setView, canUndo, undo, reset };
}
