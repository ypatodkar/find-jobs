// A multi-select filter, drawn as shadcn's faceted filter: an outline button (dashed
// while nothing is chosen, the choices as badges once something is) that opens a
// Popover holding a Command list with a search, a box per option and its count.
//
// Ids the tests and saved links use: pick- (the wrapper), sum- (the trigger, whose
// aria-label and data-summary keep the old one-line summary), q- (the search), list-
// (the options), sa- (Select all) and clr- (Clear) <key>.
//
// The order of the list is fixed when the menu opens or its search changes, never on a
// tick: re-sorting under the cursor mid-selection is disorienting. Counts are always
// current, and a selected value stays listed even at zero so it can be unticked.
//
// A dimension with `allChecked` (Company HQ) starts with every option ticked: its empty
// selection is drawn as all of them, unticking one keeps the rest, and ticking the
// last one back returns to the empty selection, so the URL stays clean.
//
// The Command does no matching of its own (shouldFilter={false}): the search matches
// labels as it always has, and a long list draws only its first MAX_OPTIONS. Each row
// also carries a native checkbox, invisible and laid over the row, so scripts and tests
// still read and set a value the way they always have (#list-role input[value=…]):
// clicking it is clicking the row.
//
// `inline` (the phone sheet) opens the list in place under the trigger instead of in a
// popover, so nothing floats over the sheet and opening it doesn't summon the keyboard.
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CirclePlusIcon, SearchIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MAX_OPTIONS = 60; // the long tail (hundreds of industry tags) is reached by searching
const MAX_BADGES = 2; // more choices than this read "N selected" on the trigger

/**
 * The list's search box, drawn with the classes of shadcn's CommandInput. Not that
 * component itself: cmdk replaces its input's id with one of its own and refocuses
 * the input by that id, so the #q-<key> hook can't live on it. cmdk's arrow keys and
 * Enter still work from here (they are handled on the Command around it). The
 * browser's own clear glyph is swapped for a quiet X, as in the toolbar's search.
 * As a combobox it points at cmdk's listbox and at the highlighted row, both by the ids
 * cmdk generates. They are read from the DOM as cmdk marks them: cmdk keeps the row's
 * id current only for its own input, and marks a row a render after it mounts.
 */
function SearchField({ input, className, onClear, ...props }) {
  const [ids, setIds] = useState({});
  useEffect(() => {
    const root = input.current?.closest("[cmdk-root]");
    if (!root) return;
    const read = () => {
      const list = root.querySelector("[cmdk-list]")?.id, active = root.querySelector('[cmdk-item][aria-selected="true"]')?.id;
      setIds((cur) => (cur.list === list && cur.active === active ? cur : { list, active }));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    return () => watch.disconnect();
  }, [input]);
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! rounded-lg! border-transparent bg-muted shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <input ref={input} type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={ids.list}
          aria-activedescendant={ids.active} autoComplete="off" autoCorrect="off" spellCheck={false} data-slot="command-input"
          className={cn("w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none", className)}
          {...props} />
        <InputGroupAddon><SearchIcon className="size-4 shrink-0 opacity-50" /></InputGroupAddon>
        {props.value ? (
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => { onClear(); input.current?.focus(); }}><XIcon /></InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Clear search</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

export default function FilterPicker({ dim, selected, counts, onChange, inline = false, className }) {
  const trigger = useRef(null), panel = useRef(null), search = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState([]);
  const [highlight, setHighlight] = useState(""); // the row Enter ticks (cmdk's value)
  const chosen = useMemo(() => new Set(selected), [selected]);
  const n = selected.length;
  const all = !!dim.allChecked && n === 0; // every option counts as ticked

  // Ordinal filters (size, seniority, career) keep their own scale; the rest lead with
  // what is selected, then by number of roles.
  const sortEntries = () => {
    const m = new Map(counts());
    chosen.forEach((v) => { if (!m.has(v)) m.set(v, 0); });
    const rank = dim.order ? (v) => { const i = dim.order.indexOf(v); return i < 0 ? Infinity : i; } : null;
    return [...m.keys()].sort((a, b) => {
      if (rank) return rank(a) - rank(b);
      const sel = (v) => (chosen.has(v) ? 0 : 1);
      return sel(a) - sel(b) || m.get(b) - m.get(a) || dim.labelFor(a).localeCompare(dim.labelFor(b));
    });
  };

  const matchesFor = (list, text) => {
    const t = text.trim().toLowerCase();
    return t ? list.filter((v) => dim.labelFor(v).toLowerCase().includes(t)) : list;
  };
  // Re-ordered on opening and on a new search, not on a tick. Either way the first row
  // is highlighted, so typing a few letters and pressing Enter ticks the first match:
  // cmdk does that only for its own input, which this list doesn't use.
  const reorder = (text) => {
    const next = sortEntries();
    setOrder(next);
    setHighlight(String(matchesFor(next, text)[0] ?? "").trim());
  };
  const onOpenChange = (next) => {
    if (next) reorder(query);
    setOpen(next);
    // In the sheet the list opens below the trigger; bring it into view.
    if (next && inline) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "nearest" }));
  };
  const onQuery = (value) => { setQuery(value); reorder(value); };

  const current = open ? new Map(counts()) : new Map();
  const q = query.trim().toLowerCase();
  const matching = matchesFor(order, query);
  const capped = !q && order.length > MAX_OPTIONS;
  const visible = capped ? matching.slice(0, MAX_OPTIONS) : matching;
  // "Select all" takes the matches when searching, else every option, not just the
  // capped head. Hidden on the exclude filter, where it would empty the list.
  const target = (q ? visible : order).filter((v) => !chosen.has(v));
  const canSelectAll = !(dim.exclude || dim.allChecked || target.length === 0);

  const summary = all ? `${dim.label}: All` : n === 0 ? dim.label : n === 1 ? dim.labelFor(selected[0]) : `(${n}) ${dim.pluralLabel}`;
  // Select all and Clear hide themselves once used. Focus moves on rather than falling
  // to the page, where ↑ / ↓ would start moving the job list under the open menu: to the
  // search in the popover, to the trigger in the sheet (no keyboard pops up).
  const bulk = (values) => {
    onChange(values);
    requestAnimationFrame(() => (inline ? trigger : search).current?.focus());
  };
  const toggle = (v, on) => {
    if (!dim.allChecked) return onChange(on ? [...selected, v] : selected.filter((x) => x !== v));
    const options = [...new Map(counts()).keys()];
    const next = all ? options.filter((x) => x !== v) : on ? [...selected, v] : selected.filter((x) => x !== v);
    onChange(options.every((x) => next.includes(x)) ? [] : next);
  };

  const face = (
    <>
      <CirclePlusIcon className="text-muted-foreground" />
      {/* The filter's own name stays whole; the chosen values give way first. */}
      <span className={n > 0 ? "shrink-0" : "truncate"}>{all ? summary : dim.label}</span>
      {n > 0 ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
          {n > MAX_BADGES
            ? <Badge variant="secondary" className="rounded-sm px-1 font-normal tabular">{n} selected</Badge>
            : selected.map((v) => (
              <Badge key={v} variant="secondary" className="max-w-32 min-w-0 shrink rounded-sm px-1 font-normal">
                <span className="truncate">{dim.labelFor(v)}</span>
              </Badge>
            ))}
        </>
      ) : null}
    </>
  );
  const triggerProps = {
    ref: trigger,
    id: `sum-${dim.key}`,
    variant: "outline",
    "aria-label": `${dim.label} filter: ${all ? "All" : n === 0 ? (dim.exclude ? "None excluded" : "Any") : summary}`,
    "data-summary": summary,
    className: cn("w-full max-w-full justify-start", n === 0 && "border-dashed", inline ? "h-11" : "h-8"),
  };

  const body = (
    <Command shouldFilter={false} value={highlight} onValueChange={setHighlight} label={`Search ${dim.label}`} className="rounded-none! bg-transparent">
      <SearchField input={search} id={`q-${dim.key}`} placeholder="Find…" aria-label={`Search ${dim.label}`}
        value={query} onChange={(e) => onQuery(e.target.value)} onClear={() => onQuery("")} className={cn(inline && "text-base")} />
      <CommandList label={`${dim.label} options`} className={inline ? "max-h-64" : "max-h-72"}>
        <div id={`list-${dim.key}`} role="group" aria-label={`Select ${dim.label}`} className="p-1">
          {visible.map((v) => {
            const count = current.get(v) || 0;
            const checked = all || chosen.has(v);
            return (
              <CommandItem key={v} value={v} onSelect={() => toggle(v, !checked)}
                className={cn("[&>svg:last-child]:hidden", inline && "py-2.5")}>
                <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs",
                  checked ? "border-primary bg-primary" : "border-input")}>
                  {checked ? <CheckIcon className="size-3.5 text-primary-foreground!" /> : null}
                </span>
                <span className={cn("min-w-0 flex-1 break-words", count === 0 && "text-muted-foreground")}>{dim.labelFor(v)}</span>
                <span className="ml-auto pl-2 text-xs tabular text-muted-foreground">{count}</span>
                {/* The ticked state in the row's name, so every screen reader says it:
                    cmdk's aria-selected marks only the arrow-key cursor, and VoiceOver
                    ignores aria-checked on an option. "checked", not "selected", so it is
                    not confused with that cursor. */}
                <span className="sr-only">{checked ? ", checked" : ", not checked"}</span>
                {/* The state as a native checkbox, for scripts and tests; the row draws it. */}
                <input type="checkbox" value={v} checked={checked} readOnly tabIndex={-1} aria-hidden="true"
                  onMouseDown={(e) => e.preventDefault() /* keep focus in the search */}
                  className="absolute inset-0 size-full cursor-default appearance-none opacity-0" />
              </CommandItem>
            );
          })}
        </div>
        {visible.length ? null : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query ? `No match for “${query}”.` : "Nothing left under the current filters."}</p>
        )}
        {capped ? <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">Top {MAX_OPTIONS} of {order.length} — search to find the rest.</p> : null}
      </CommandList>
      <div className="flex items-center gap-1 border-t p-1" hidden={!canSelectAll && n === 0}>
        <Button type="button" variant="ghost" size="sm" id={`sa-${dim.key}`} hidden={!canSelectAll}
          className={cn("tabular", inline && "h-11")} onClick={() => bulk([...selected, ...target])}>
          {q ? `Select all ${target.length} matching` : `Select all ${target.length}`}
        </Button>
        <Button type="button" variant="ghost" size="sm" id={`clr-${dim.key}`} hidden={n === 0}
          className={cn("ml-auto", inline && "h-11")} onClick={() => bulk([])}>
          {dim.allChecked ? "Select all" : "Clear"}
        </Button>
      </div>
    </Command>
  );

  if (inline) {
    // Escape closes this list and returns to its trigger, and goes no further, so the
    // sheet around it stays open. A layer above it (a tooltip) has had its turn first.
    const onKeyDown = (e) => {
      if (e.key !== "Escape" || !open || e.defaultPrevented) return;
      e.preventDefault(); e.stopPropagation();
      setOpen(false); trigger.current?.focus();
    };
    return (
      <Collapsible open={open} onOpenChange={onOpenChange} id={`pick-${dim.key}`} className={cn("picker-wrap min-w-0", className)} onKeyDown={onKeyDown}>
        <CollapsibleTrigger asChild>
          <Button {...triggerProps}>
            {face}
            <ChevronDownIcon className="ml-auto text-muted-foreground transition-transform group-aria-expanded/button:rotate-180 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent ref={panel} className="mt-2 overflow-hidden rounded-lg border bg-popover text-popover-foreground">
          {body}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div id={`pick-${dim.key}`} className={cn("picker-wrap min-w-0", className)}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button size="sm" {...triggerProps}>{face}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={8} aria-label={`${dim.label} filter`} className="w-72 gap-0 p-0">{body}</PopoverContent>
      </Popover>
    </div>
  );
}
