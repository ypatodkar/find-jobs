// A single-choice menu (Sort, Posted, Salary), on shadcn's Select. With a placeholder,
// the trigger shows it while the default is chosen, and is marked as having a selection
// otherwise: a dashed border while untouched, solid once set, like the faceted filters
// beside it, and data-has-selection on the wrapper and the trigger.
//
// Hooks other code relies on: the wrapper is #menu-<id>, the trigger #<id>, labelled
// "<label>: <what it shows>". The options are role="option" in a listbox that Radix
// draws in a portal, so they are found from the page, not from inside the wrapper.
// Radix opens it with ↓ / ↑ / Enter / Space, focuses the current choice, and returns
// focus to the trigger on Escape or a choice.
//
// Optional beyond the old props: `className` for the wrapper (it shrinks to fit, and
// fills a grid cell), and `size` "lg" for the 44px touch target of the phone sheet.
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SelectMenu({ id, label, options, value, onChange, placeholder, placeholderValue, disabled, className, size = "sm" }) {
  const current = options.find((o) => o.value === value) || options[0];
  const isDefault = placeholder && value === placeholderValue;
  const text = placeholder && (!current || isDefault) ? placeholder : current ? current.label : "";
  const hasSelection = !!(placeholder && current && !isDefault);
  const lg = size === "lg";

  return (
    <div id={id ? `menu-${id}` : undefined} data-has-selection={hasSelection || undefined}
      className={cn("inline-flex min-w-0", className)}>
      <Select value={current ? current.value : undefined} disabled={disabled}
        onValueChange={(v) => { if (v !== value) onChange(v); }}>
        <SelectTrigger id={id} size={lg ? "default" : "sm"} aria-label={label ? `${label}: ${text}` : text}
          data-has-selection={hasSelection || undefined}
          className={cn("w-full min-w-0", lg && "data-[size=default]:h-11", placeholder && !hasSelection && "border-dashed")}>
          {/* Children, not Radix's own value text: the placeholder stands in for the default. */}
          <SelectValue>{text}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" aria-label={label}>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
