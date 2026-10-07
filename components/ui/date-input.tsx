import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Keep the native date picker within its container, including on Safari. */
export function DateInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input {...props} type="date" className={cn(
    "native-date-input block box-border w-full min-w-0 max-w-full appearance-none",
    className,
  )} />;
}
