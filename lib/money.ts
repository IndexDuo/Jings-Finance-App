// Integer-cents wrapper. All monetary values in the app are integer cents.
// See docs/ACCOUNTING.md Floats are forbidden for money.

export class Money {
  private readonly cents: number;

  private constructor(cents: number) {
    if (!Number.isInteger(cents)) {
      throw new Error(`Money cents must be an integer, got ${cents}`);
    }
    this.cents = cents;
  }

  static fromCents(cents: number): Money {
    return new Money(cents);
  }

  // Accepts dollars as number or string (e.g. "12.50"). Rounds at the
  // boundary per docs/ACCOUNTING.md
  static fromDollars(dollars: number | string): Money {
    const n = typeof dollars === "string" ? Number(dollars) : dollars;
    if (!Number.isFinite(n)) {
      throw new Error(`Money.fromDollars: invalid input ${dollars}`);
    }
    return new Money(Math.round(n * 100));
  }

  static zero(): Money {
    return new Money(0);
  }

  static sum(items: readonly Money[]): Money {
    let total = 0;
    for (const m of items) total += m.cents;
    return new Money(total);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  // Multiply by a real-valued factor (e.g. 0.6 for 60%). Rounds to nearest cent.
  multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new Error(`Money.multiply: non-finite factor ${factor}`);
    }
    return new Money(Math.round(this.cents * factor));
  }

  // Divide by an integer count of buckets. Returns the even per-bucket
  // quotient plus the remainder cents that didn't split evenly — callers
  // decide how to distribute the remainder so no cent is lost.
  divide(divisor: number): { quotient: Money; remainder: number } {
    if (!Number.isInteger(divisor) || divisor <= 0) {
      throw new Error(`Money.divide: divisor must be a positive integer, got ${divisor}`);
    }
    const quotient = Math.trunc(this.cents / divisor);
    const remainder = this.cents - quotient * divisor;
    return { quotient: new Money(quotient), remainder };
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.cents < other.cents) return -1;
    if (this.cents > other.cents) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  negate(): Money {
    return new Money(-this.cents);
  }

  max(other: Money): Money {
    return this.cents >= other.cents ? this : other;
  }

  min(other: Money): Money {
    return this.cents <= other.cents ? this : other;
  }

  toCents(): number {
    return this.cents;
  }

  // "700.00" — plain decimal string, no currency symbol.
  toDollars(): string {
    const neg = this.cents < 0;
    const abs = Math.abs(this.cents);
    const whole = Math.trunc(abs / 100).toString();
    const frac = (abs % 100).toString().padStart(2, "0");
    return `${neg ? "-" : ""}${whole}.${frac}`;
  }

  // "$700.00" with thousands separators. For display only.
  format(): string {
    const neg = this.cents < 0;
    const abs = Math.abs(this.cents);
    const whole = Math.trunc(abs / 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const frac = (abs % 100).toString().padStart(2, "0");
    return `${neg ? "-$" : "$"}${whole}.${frac}`;
  }
}
