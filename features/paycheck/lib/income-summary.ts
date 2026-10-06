import { Money } from "@/lib/money";

export function summarizePaycheckIncome(args: {
  baselineCents: number;
  extraIncomeCents: number;
  assignedInvestmentCents: number;
  currentIncomeInvestmentCents: number;
}) {
  return {
    ...args,
    totalCents: Money.fromCents(args.baselineCents)
      .add(Money.fromCents(args.extraIncomeCents))
      .add(Money.fromCents(args.assignedInvestmentCents))
      .subtract(Money.fromCents(args.currentIncomeInvestmentCents)).toCents(),
  };
}
