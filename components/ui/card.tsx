import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// iOS-style grouped list card.
// Note: this is our project-local "grouped card" primitive, distinct from
// Generic cards are not used for app screens.

export interface GroupedCardProps extends HTMLAttributes<HTMLElement> {
  header?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

export function GroupedCard({
  header,
  trailing,
  children,
  className,
  ...rest
}: GroupedCardProps) {
  return (
    <section
      className={cn(
        "ledger-card bg-system-bg rounded-card shadow-ios-card overflow-hidden",
        className,
      )}
      {...rest}
    >
      {(header || trailing) && (
        <header className="flex items-center justify-between px-5 pt-4 pb-2">
          {header ? (
            <h2 className="text-[15px] font-semibold text-label">{header}</h2>
          ) : (
            <span />
          )}
          {trailing && (
            <div className="text-[15px] text-system-blue">{trailing}</div>
          )}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
