import { cn } from "@/lib/utils";

// Pulsing skeleton block. Use instead of spinners — renders instantly and
// communicates "content is loading" without jumping layout.

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-button bg-secondary-system-bg",
        className,
      )}
      aria-hidden
    />
  );
}

// Pre-built page-level skeleton that matches the grouped-card layout used on
// every (app)/ page (header + 3 cards). Import in loading.tsx files.
export function PageSkeleton() {
  return (
    <div className="min-h-svh bg-grouped-bg">
      <div className="mx-auto max-w-xl px-5 pt-4 pb-24 space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-9 rounded-pill" />
        </div>
        {/* Hero card */}
        <div className="rounded-card bg-system-bg shadow-ios-card p-5 space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        {/* List card */}
        <div className="rounded-card bg-system-bg shadow-ios-card overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b border-separator last:border-b-0">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
        {/* Second list card */}
        <div className="rounded-card bg-system-bg shadow-ios-card overflow-hidden">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b border-separator last:border-b-0">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
