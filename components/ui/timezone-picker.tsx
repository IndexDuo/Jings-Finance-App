"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { matchingTimezones, timezoneFromText } from "@/lib/timezones";
import { cn } from "@/lib/utils";

export function TimezonePicker({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const options = matchingTimezones(query ?? "", value);

  useEffect(() => {
    const option = list.current?.children[active] as HTMLElement | undefined;
    const container = list.current;
    if (!option || !container) return;
    if (option.offsetTop < container.scrollTop) container.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > container.scrollTop + container.clientHeight)
      container.scrollTop = option.offsetTop + option.offsetHeight - container.clientHeight;
  }, [active]);

  function choose(zone: string) {
    onChange(zone);
    input.current?.focus();
    setQuery(null);
    setOpen(false);
    setActive(-1);
  }

  return <div onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    const typed = query !== null ? timezoneFromText(query) : null;
    if (typed) onChange(typed);
    setQuery(null);
    setOpen(false);
    setActive(-1);
  }}>
    <label htmlFor={id} className="block text-[13px] font-medium text-secondary-label">Timezone</label>
    <div className={cn("mt-1 flex min-h-12 w-full min-w-0 items-center rounded-button bg-secondary-system-bg focus-within:ring-2 focus-within:ring-system-blue", open && "bg-system-bg")}>
      <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={`${id}-options`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-describedby={`${id}-hint`} autoComplete="off" autoCapitalize="none" spellCheck={false} required
        className="min-h-12 min-w-0 flex-1 bg-transparent pl-4 text-[17px] text-label outline-none"
        value={query ?? value} placeholder="Search a city or region"
        onFocus={event => { setOpen(true); setActive(options.indexOf(value)); event.currentTarget.select(); }}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive(previous => event.key === "ArrowDown"
              ? Math.min(options.length - 1, previous + 1)
              : Math.max(0, previous < 0 ? options.length - 1 : previous - 1));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const zone = active >= 0 ? options[active] : timezoneFromText(query ?? value);
            if (zone) choose(zone);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setQuery(null); setOpen(false); setActive(-1);
          }
        }}/>
      {query !== null && query !== "" && <button type="button" aria-label="Clear timezone search"
        className="flex h-11 w-9 shrink-0 items-center justify-center text-secondary-label"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { input.current?.focus(); setQuery(""); setOpen(true); setActive(-1); }}>
        <X className="h-4 w-4" aria-hidden/>
      </button>}
      <button type="button" aria-label={open ? "Hide timezones" : "Show timezones"} aria-expanded={open}
        aria-controls={`${id}-options`} className="flex h-12 w-11 shrink-0 items-center justify-center text-label"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { const next = !open; input.current?.focus(); setOpen(next); setActive(next ? options.indexOf(value) : -1); }}>
        <ChevronDown className={cn("h-4 w-4", open && "rotate-180")} aria-hidden/>
      </button>
    </div>
    {open && <div ref={list} id={`${id}-options`} role="listbox" aria-label="Timezones"
      className="relative mt-2 max-h-[min(15rem,35dvh)] w-full overflow-y-auto overscroll-contain rounded-button border border-separator bg-system-bg">
      {options.map((zone, index) => <button key={zone} id={`${id}-option-${index}`} type="button" role="option"
        aria-selected={zone === value} tabIndex={-1}
        className={cn("flex min-h-12 w-full items-center gap-2 border-b border-separator px-4 py-3 text-left text-[15px] last:border-b-0",
          zone === value || active === index ? "bg-system-blue/10 text-label" : "text-label")}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(zone)}>
        <span className="min-w-0 flex-1 break-words">{zone}</span>
        {zone === value && <Check className="h-4 w-4 shrink-0 text-system-blue" aria-hidden/>}
      </button>)}
      {!options.length && <p role="status" className="px-4 py-3 text-[13px] text-secondary-label">No matches. Try a city, like Chicago.</p>}
    </div>}
    <p id={`${id}-hint`} className="mt-2 text-[13px] text-secondary-label">Search a city or region, like Chicago or America.</p>
  </div>;
}
