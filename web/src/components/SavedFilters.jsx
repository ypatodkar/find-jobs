// Saved filters (lib/presets.js): a "Saved" button in the toolbar, beside View, opening
// a small panel that lists them. Each can be applied, renamed or removed, the one on
// screen is marked, and "Save current filters" names the view on screen. Naming offers
// a suggested name (describe()), focused and selected, so Enter accepts it and typing
// replaces it; Escape cancels the naming, and a second Escape closes the panel.
//
// A panel of its own rather than entries in the View menu: renaming needs a text box
// and each row has three actions, and a menu's type-to-find and arrow-key focus would
// swallow the typing and skip the row's buttons.
//
// `inline` (the phone sheet) draws the same list in place, under a heading.
import { useEffect, useRef, useState } from "react";
import { BookmarkCheckIcon, BookmarkIcon, BookmarkPlusIcon, CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { MAX_NAME, describe, presets, same, usePresets } from "../lib/presets.js";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function NameForm({ initial, onSave, onCancel, inline }) {
  const input = useRef(null), form = useRef(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    input.current.focus({ preventScroll: true }); input.current.select();
    form.current.scrollIntoView({ block: "nearest" }); // its buttons too, not just the box
  }, []);
  const commit = () => { const v = value.trim(); if (!v) { input.current.focus(); return; } onSave(v); };
  return (
    <div ref={form} className="preset-naming flex flex-col gap-2 p-1" onKeyDown={(e) => {
      if (e.key === "Enter" && e.target === input.current) { e.preventDefault(); commit(); }
      // In the toolbar's panel, Radix has seen this Escape first (onEscapeKeyDown below).
      else if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onCancel(); }
    }}>
      <Input ref={input} type="text" id="preset-name" className={cn("preset-name", inline ? "h-11 text-base" : "h-8")} maxLength={MAX_NAME}
        placeholder="Name this filter" aria-label="Name this filter" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size={inline ? "lg" : "sm"} id="preset-cancel" className="preset-cancel" onClick={onCancel}>Cancel</Button>
        <Button type="button" size={inline ? "lg" : "sm"} id="preset-confirm" className="preset-confirm" onClick={commit}>Save</Button>
      </div>
    </div>
  );
}

function IconAction({ label, tip, onClick, inline, className, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size={inline ? "icon-lg" : "icon-sm"} aria-label={label}
          className={cn("text-muted-foreground", inline && "size-11", className)} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export default function SavedFilters({ filters, onApply, naming, inline = false }) {
  const items = usePresets();
  const root = useRef(null);
  const refocus = useRef(null); // a selector to focus once the list has re-rendered
  const [editing, setEditing] = useState(null); // null, { id: null } (new), { id } (rename)
  const [open, setOpen] = useState(false);
  const active = items.find((p) => same(p.filters, filters)) || null;

  // After naming ends or a row goes, focus lands on what stands in its place: a row's
  // name, never its icon buttons, whose tooltips would open on focus and take the next
  // Escape.
  useEffect(() => {
    if (!refocus.current) return;
    const el = root.current?.querySelector(refocus.current) || root.current?.querySelector("#preset-save");
    refocus.current = null;
    el?.focus();
  });

  // Read from the updater, so a second call for the same Escape finds nothing to stop.
  const stopEditing = () => setEditing((cur) => {
    if (cur) refocus.current = cur.id ? `[data-preset-id="${CSS.escape(cur.id)}"] .preset-apply` : "#preset-save";
    return null;
  });
  const remove = (p, i) => {
    const next = items[i + 1] || items[i - 1];
    refocus.current = next ? `[data-preset-id="${CSS.escape(next.id)}"] .preset-apply` : "#preset-save";
    presets.remove(p.id);
    if (editing && editing.id === p.id) setEditing(null);
  };
  const apply = (p) => { if (!inline) setOpen(false); onApply(p.filters); };

  const list = items.length ? (
    <ul className="flex flex-col gap-0.5" aria-label="Saved filters">
      {items.map((p, i) => {
        if (editing && editing.id === p.id) {
          return (
            <li key={p.id} className="preset-row is-editing">
              <NameForm initial={p.name} inline={inline} onCancel={stopEditing} onSave={(name) => { presets.rename(p.id, name); stopEditing(); }} />
            </li>
          );
        }
        const on = !!active && active.id === p.id;
        return (
          <li key={p.id} data-preset-id={p.id} aria-current={on || undefined}
            className={cn("preset-row flex items-center gap-0.5 rounded-md", on && "is-active bg-muted")}>
            <Button type="button" variant="ghost" size={inline ? "lg" : "sm"} title="Apply these filters" onClick={() => apply(p)}
              className={cn("preset-apply min-w-0 flex-1 justify-start font-normal", on && "font-medium hover:bg-transparent", inline && "h-11")}>
              {on ? <CheckIcon /> : <span className="size-4 shrink-0" aria-hidden="true" />}
              <span className="truncate">{p.name}</span>
            </Button>
            <IconAction label={`Rename ${p.name}`} tip="Rename" inline={inline} className="preset-edit" onClick={() => setEditing({ id: p.id })}>
              <PencilIcon />
            </IconAction>
            <IconAction label={`Remove ${p.name}`} tip="Remove" inline={inline} className="preset-del" onClick={() => remove(p, i)}>
              <XIcon />
            </IconAction>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className={cn("py-2 text-sm text-muted-foreground", !inline && "px-2")}>Nothing saved yet. Save the filters you use often to come back to them in one click.</p>
  );

  // In the sheet it is drawn like the controls stacked above it.
  const save = editing && editing.id === null ? (
    <NameForm initial={describe(filters, naming)} inline={inline} onCancel={stopEditing}
      onSave={(name) => { presets.save(name, filters); stopEditing(); }} />
  ) : (
    <Button type="button" variant={inline ? "outline" : "ghost"} size={inline ? "lg" : "sm"} id="preset-save" title="Save the current filters"
      className={cn("preset-save w-full justify-start", inline && "h-11")} onClick={() => setEditing({ id: null })}>
      <BookmarkPlusIcon />Save current filters
    </Button>
  );

  if (inline) {
    return (
      <section ref={root} id="preset-bar" aria-labelledby="preset-heading" className="flex flex-col gap-1">
        <h3 id="preset-heading" className="text-sm font-medium">Saved filters</h3>
        {list}
        {save}
      </section>
    );
  }

  return (
    <div id="preset-bar" className="contents">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setEditing(null); }}>
        {/* The button keeps one width in a full row: a saved view on screen shows as the
            ticked bookmark here (and by name in its label), and as the marked row inside. */}
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" id="preset-picker"
            aria-label={`Saved filters${items.length ? `, ${items.length} saved` : ""}${active ? `, showing ${active.name}` : ""}`}>
            {active ? <BookmarkCheckIcon /> : <BookmarkIcon />}Saved
            {items.length ? <Badge variant="secondary" className="rounded-sm px-1 font-normal tabular">{items.length}</Badge> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent ref={root} align="end" collisionPadding={8} className="w-80 gap-0 p-0"
          // Escape while naming cancels the naming; the next one closes the panel.
          onEscapeKeyDown={(e) => { if (editing) { e.preventDefault(); stopEditing(); } }}>
          <div className="border-b px-3 py-2.5 text-sm font-medium">Saved filters</div>
          <div className="max-h-72 overflow-y-auto p-1">{list}</div>
          <div className="border-t p-1">{save}</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
