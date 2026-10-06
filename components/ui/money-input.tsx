"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { evaluate } from "mathjs";
import { cn } from "@/lib/utils";

// Math-expression-aware money input.
// The whitelist regex is the security boundary: mathjs can do more than arithmetic
// (variables, function calls). Only digits, whitespace, and the five infix ops plus
// parens are allowed to reach evaluate().

const EXPR_RE = /^[\d\s+\-*/.()]+$/;
const CENTS_RE = /^-?\d+$/;

export type MoneyEntryMode = "decimal" | "cents";

export function evaluateExpression(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (!EXPR_RE.test(s)) return null;
  try {
    const result = evaluate(s);
    if (typeof result !== "number" || !Number.isFinite(result)) return null;
    return Math.round(result * 100);
  } catch {
    return null;
  }
}

export function evaluateMoneyInput(
  input: string,
  entryMode: MoneyEntryMode = "decimal",
): number | null {
  const s = input.trim();
  if (!s) return null;
  if (entryMode === "cents" && CENTS_RE.test(s)) {
    const cents = Number.parseInt(s, 10);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  return evaluateExpression(s);
}

function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
>;

export interface MoneyInputProps extends NativeInputProps {
  value: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  entryMode?: MoneyEntryMode;
}

export function MoneyInput({
  value,
  onChange,
  placeholder = "0.00",
  entryMode = "decimal",
  className,
  disabled,
  onBlur,
  onFocus,
  onKeyDown,
  ...rest
}: MoneyInputProps) {
  const [raw, setRaw] = useState(value != null ? formatCents(value) : "");
  const [error, setError] = useState(false);
  const [focused, setFocused] = useState(false);
  const committedRef = useRef<number | null>(value);

  // Sync from parent when the committed value changes externally and we're not editing.
  useEffect(() => {
    if (focused) return;
    if (value !== committedRef.current) {
      setRaw(value != null ? formatCents(value) : "");
      committedRef.current = value;
      setError(false);
    }
  }, [value, focused]);

  const commit = () => {
    if (raw.trim() === "") {
      setError(false);
      if (committedRef.current !== null) {
        onChange(null);
        committedRef.current = null;
      }
      return;
    }
    const cents = evaluateMoneyInput(raw, entryMode);
    if (cents == null) {
      setError(true);
      return;
    }
    setError(false);
    setRaw(formatCents(cents));
    if (cents !== committedRef.current) {
      onChange(cents);
      committedRef.current = cents;
    }
  };

  return (
    <div
      className={cn(
        "flex min-w-0 w-full items-center h-12 px-4 gap-1 bg-secondary-system-bg rounded-button",
        "ring-1 transition-[box-shadow,--tw-ring-color]",
        error ? "ring-system-red" : "ring-transparent",
        disabled && "opacity-50",
        className,
      )}
    >
      <span className="text-[17px] text-label select-none">$</span>
      <input
        {...rest}
        type="text"
        inputMode={entryMode === "cents" ? "numeric" : "decimal"}
        disabled={disabled}
        placeholder={placeholder}
        value={raw}
        title={raw}
        aria-invalid={error || undefined}
        onChange={(e) => {
          setRaw(e.target.value);
          if (error) setError(false);
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          commit();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }
          onKeyDown?.(e);
        }}
        className={cn(
          "min-w-0 w-full flex-1 bg-transparent outline-none text-[17px] text-label tabular-nums",
          "placeholder:text-tertiary-label",
        )}
      />
    </div>
  );
}
