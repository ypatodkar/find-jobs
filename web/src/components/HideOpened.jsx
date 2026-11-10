// The two Hide toggles, as checkboxes on a line under the list head (All jobs /
// Companies and Sort), at every width. They are filters (filters.hideOpened,
// filters.hideOpenedCompanies), so they go in the address bar and saved filters like
// the rest.
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const HIDE = [
  { key: "hideOpened", id: "hide-opened", label: "Hide roles I’ve opened", short: "Hide opened roles", hint: "Roles you have already opened from this site" },
  { key: "hideOpenedCompanies", id: "hide-opened-companies", label: "Hide companies I’ve opened", short: "Hide opened companies", hint: "Leaves only companies you have never opened a role at" },
];

export default function HideOpened({ filters, onChange }) {
  return (
    <div id="hide-toggles" role="group" aria-label="Hide what you’ve opened" className="flex flex-wrap items-center gap-x-4 sm:gap-x-5">
      {HIDE.map((h) => (
        // 44px tall on touch screens, a text line on desktop. On a phone the shorter
        // wording keeps both on one line. The box is paper, like the other controls on
        // the page; a bare outline vanished into the page colour.
        <Label key={h.id} htmlFor={h.id} title={h.hint}
          className="min-h-11 cursor-pointer gap-2 font-normal text-muted-foreground hover:text-foreground has-data-checked:text-foreground sm:min-h-8">
          <Checkbox id={h.id} className="bg-background" checked={!!filters[h.key]} onCheckedChange={(c) => onChange({ ...filters, [h.key]: c === true })} />
          <span className="sm:hidden">{h.short}</span>
          <span className="hidden sm:inline">{h.label}</span>
        </Label>
      ))}
    </div>
  );
}
