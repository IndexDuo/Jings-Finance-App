import { addDays, format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { computeCurrentPaycheckWaterfall } from './current-waterfall';

// Fictional account: the normal subscription contribution uses its last $9.23.
const payday = new Date(2031, 0, 3, 12);
const base: Parameters<typeof computeCurrentPaycheckWaterfall>[0] = {
  takeHomeCents: 100_000, extraIncomeCents: 0, payAnchor: payday, currentPay: payday, periodStartIso: '2031-01-03',
  fixedRows: [{ id: 'subscription', name: 'Subscription', amountCents: 2000,
    frequency: 'monthly', dueDay: 1, lastPaidDate: null, nextDueDate: '2031-02-01' }],
  envelopeRows: [{ id: 'budget', name: 'Budget', periodAmountCents: 99_077,
    period: 'biweekly', category: 'variable', recurrence: 'recurring', isPiggy: false }],
  goalRows: [], cardRows: [], periodTransactionRows: [], currentFixedPaymentRows: [],
  currentGoalTransferRows: [], currentCardFundingRows: [],
};
const freePayment = { fixedExpenseId: 'subscription', dueDate: '2031-01-01', expectedCents: 2000, actualCents: 0 };

describe('skipped subscription accounting', () => {
  it('uses the whole $20 saving once against an earlier advance and carries the rest', () => {
    const args = { ...base, investmentAdvanceCents: 6500, currentFixedPaymentRows: [freePayment] };
    const first = computeCurrentPaycheckWaterfall(args);
    expect(first.steps.find(s => s.kind === 'fixed')?.amountCents).toBe(-1077);
    expect(first.investmentAdvanceAppliedCents).toBe(2000);
    expect(first.investmentAdvanceRemainingCents).toBe(4500);
    expect(first.investmentPoolCents).toBe(0);
    const saved = computeCurrentPaycheckWaterfall({ ...args, investmentAdvanceApplicationLimitCents: 2000 });
    expect(saved).toEqual(first);
    const next = computeCurrentPaycheckWaterfall({ ...base, currentPay: addDays(payday, 14),
      periodStartIso: '2031-01-17', investmentAdvanceCents: saved.investmentAdvanceRemainingCents });
    expect(next.steps.find(s => s.kind === 'fixed')?.amountCents).toBe(923);
    expect(next.investmentAdvanceAppliedCents).toBe(0);
    expect(next.investmentAdvanceRemainingCents).toBe(4500);
    for (const result of [first, saved, next]) {
      expect(result.steps.reduce((sum, s) => sum + s.amountCents, 0)).toBe(base.takeHomeCents);
    }
  });

  it('keeps a saved partial application capped even when more cash becomes available', () => {
    const result = computeCurrentPaycheckWaterfall({ ...base, takeHomeCents: 110_000,
      investmentAdvanceCents: 6500, investmentAdvanceApplicationLimitCents: 2000 });
    expect(result.investmentAdvanceAppliedCents).toBe(2000);
    expect(result.investmentAdvanceRemainingCents).toBe(4500);
    expect(result.investmentPoolCents).toBe(8000);
  });

  it('caps a stale saved application at the outstanding advance and available cash', () => {
    const result = computeCurrentPaycheckWaterfall({ ...base,
      currentFixedPaymentRows: [freePayment], investmentAdvanceCents: 1500,
      investmentAdvanceApplicationLimitCents: 3000 });
    expect(result.investmentAdvanceAppliedCents).toBe(1500);
    expect(result.investmentAdvanceRemainingCents).toBe(0);
    expect(result.investmentPoolCents).toBe(500);
    const spent = computeCurrentPaycheckWaterfall({ ...base, investmentAdvanceCents: 6500,
      investmentAdvanceApplicationLimitCents: 2000 });
    expect(spent.investmentAdvanceAppliedCents).toBe(0);
    expect(spent.investmentAdvanceRemainingCents).toBe(6500);
  });

  it('recognizes five free monthly occurrences as $100, not an extra release every payday', () => {
    let normalTotal = 0;
    let discountedTotal = 0;
    for (let index = 0; index < 26; index++) {
      const currentPay = addDays(payday, index * 14);
      const periodStartIso = format(currentPay, 'yyyy-MM-dd');
      const args = { ...base, currentPay, periodStartIso };
      const normal = computeCurrentPaycheckWaterfall(args);
      // Each free occurrence belongs to exactly one paycheck; alternate checks get no adjustment.
      const free = index < 10 && index % 2 === 0;
      const discounted = computeCurrentPaycheckWaterfall({ ...args,
        currentFixedPaymentRows: free ? [{ ...freePayment, dueDate: `2031-0${index / 2 + 1}-01` }] : [] });
      normalTotal += normal.steps.find(s => s.kind === 'fixed')!.amountCents;
      discountedTotal += discounted.steps.find(s => s.kind === 'fixed')!.amountCents;
      expect(discounted.investmentPoolCents - normal.investmentPoolCents).toBe(free ? 2000 : 0);
    }
    expect(normalTotal).toBe(23_998); // Existing cent rounding: $239.98, not exactly $240.
    expect(discountedTotal).toBe(13_998);
    expect(normalTotal - discountedTotal).toBe(10_000);
  });
});
