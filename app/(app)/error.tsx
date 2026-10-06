"use client";

// Shared error boundary for all (app)/ routes.
// Next.js calls this component when a Server Component throws.


export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {

  return (
    <div className="min-h-svh bg-grouped-bg flex flex-col items-center justify-center px-8 text-center">
      <p className="text-[17px] font-semibold text-label">Something went wrong</p>
      <p className="mt-2 text-[15px] text-secondary-label max-w-xs">
        This page could not load. Please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 h-11 px-8 rounded-button bg-system-blue text-[15px] font-medium text-white active:scale-[0.99]"
      >
        Try again
      </button>
    </div>
  );
}
