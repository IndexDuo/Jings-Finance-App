import { cn } from "@/lib/utils";

function formatCents(cents: number, showPositiveSign: boolean): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100).toString().padStart(2, "0");
  const sign = neg ? "-" : showPositiveSign && cents > 0 ? "+" : "";
  return `${sign}$${whole}.${frac}`;
}

export function AnimatedMoney({
  cents,
  className,
  showPositiveSign = false,
}: {
  cents: number;
  className?: string;
  showPositiveSign?: boolean;
}) {
  return (
    <span
      key={`${cents}:${showPositiveSign}`}
      className={cn("ledger-number tabular-nums", className)}
    >
      {formatCents(cents, showPositiveSign)}
    </span>
  );
}
