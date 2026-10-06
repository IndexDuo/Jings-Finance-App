"use client";

import { FolderOpen, BookOpen, Target, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/log", label: "Log", Icon: BookOpen },
  { href: "/paycheck", label: "Paycheck", Icon: Wallet },
  { href: "/projects", label: "Projects", Icon: FolderOpen },
  { href: "/goals", label: "Plans", Icon: Target },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-30 flex items-stretch border-t border-separator bg-system-bg/90 shadow-[0_-10px_30px_rgba(20,24,32,0.06)] backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-system-blue",
              active ? "text-system-blue" : "text-tertiary-label",
            )}
          >
            <span
              className={cn(
                "rounded-pill px-3 py-0.5 transition-colors",
                active && "bg-system-blue/10 shadow-ledger-glow",
              )}
            >
              <Icon
                className={cn("w-5 h-5 transition-colors", active ? "text-system-blue" : "text-tertiary-label")}
                aria-hidden
              />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
