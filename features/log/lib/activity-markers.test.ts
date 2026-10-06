import { describe, expect, it } from "vitest";

import {
  computeActivityMarkers,
  computeNoteDates,
  type MarkerEnvelope,
} from "./activity-markers";

const anchor = "2037-04-17";

const fictionalLeisure: MarkerEnvelope = {
  id: "eat",
  category: "guilt-free",
  periodAmountCents: 9_766,
  period: "weekly",
  rolloverBehavior: "accumulate",
};

const groceries: MarkerEnvelope = {
  id: "groc",
  category: "variable",
  periodAmountCents: 30_000,
  period: "monthly",
  rolloverBehavior: "reset",
};

describe("computeActivityMarkers", () => {
  it("uses the past allowance for historical dots after a later budget increase", () => {
    const oldEnvelope: MarkerEnvelope = { ...groceries, period: "weekly", periodAmountCents: 5000 };
    const newEnvelope: MarkerEnvelope = { ...oldEnvelope, periodAmountCents: 10000 };
    const markers = computeActivityMarkers({ envelopes: [newEnvelope], payAnchorIso: anchor,
      datedConfiguration: {
        "2037-04-18": { envelopes: [oldEnvelope], payAnchorIso: anchor, periodStartIso: "2037-04-17" },
        "2037-05-02": { envelopes: [newEnvelope], payAnchorIso: anchor, periodStartIso: "2037-05-01" },
      },
      transactions: [
        { date: "2037-04-18", amountCents: -15000, category: "variable", envelopeId: "groc" },
        { date: "2037-05-02", amountCents: -15000, category: "variable", envelopeId: "groc" },
      ],
    });
    expect(markers.get("2037-04-18")).toBe("red");
    expect(markers.get("2037-05-02")).toBe("green");
  });
  it("$10 + $2 + $4 within the envelope budget stays green", () => {
    const markers = computeActivityMarkers({
      envelopes: [fictionalLeisure],
      payAnchorIso: anchor,
      transactions: [
        { date: "2037-05-04", amountCents: -1_000, category: "guilt-free", envelopeId: "eat" },
        { date: "2037-05-04", amountCents: -200, category: "guilt-free", envelopeId: "eat" },
        { date: "2037-05-04", amountCents: -400, category: "guilt-free", envelopeId: "eat" },
      ],
    });

    expect(markers.get("2037-05-04")).toBe("green");
  });

  it("turns red only on the date that pushes an envelope over its budget window", () => {
    const markers = computeActivityMarkers({
      envelopes: [fictionalLeisure],
      payAnchorIso: anchor,
      transactions: [
        { date: "2037-05-04", amountCents: -4_000, category: "guilt-free", envelopeId: "eat" },
        { date: "2037-05-05", amountCents: -5_000, category: "guilt-free", envelopeId: "eat" },
        { date: "2037-05-06", amountCents: -2_000, category: "guilt-free", envelopeId: "eat" },
      ],
    });

    expect(markers.get("2037-05-04")).toBe("green");
    expect(markers.get("2037-05-05")).toBe("green");
    expect(markers.get("2037-05-06")).toBe("red");
  });

  it("uses paycheck-period allocation for reset variable envelopes", () => {
    const markers = computeActivityMarkers({
      envelopes: [groceries],
      payAnchorIso: anchor,
      transactions: [
        { date: "2037-05-01", amountCents: -8_000, category: "variable", envelopeId: "groc" },
        { date: "2037-05-08", amountCents: -7_000, category: "variable", envelopeId: "groc" },
      ],
    });

    expect(markers.get("2037-05-01")).toBe("green");
    expect(markers.get("2037-05-08")).toBe("red");
  });

  it("fixed expenses and income never create red allowance markers", () => {
    const markers = computeActivityMarkers({
      envelopes: [fictionalLeisure],
      payAnchorIso: anchor,
      transactions: [
        { date: "2037-05-04", amountCents: -200_000, category: "fixed", envelopeId: null },
        { date: "2037-05-05", amountCents: 150_000, category: "income", envelopeId: null },
      ],
    });

    expect(markers.get("2037-05-04")).toBe("green");
    expect(markers.get("2037-05-05")).toBe("green");
  });

  it("note-only dates stay gray", () => {
    const markers = computeActivityMarkers({
      envelopes: [fictionalLeisure],
      payAnchorIso: anchor,
      transactions: [
        { date: "2037-05-04", amountCents: 0, category: "note", envelopeId: null },
      ],
    });

    expect(markers.get("2037-05-04")).toBe("gray");
  });

  it("preserves note presence when spending makes the primary marker green", () => {
    const transactions = [
      { date: "2037-05-21", amountCents: 0, category: "note" as const, envelopeId: null },
      { date: "2037-05-21", amountCents: -500, category: "fixed" as const, envelopeId: null },
    ];

    const markers = computeActivityMarkers({
      envelopes: [fictionalLeisure],
      payAnchorIso: anchor,
      transactions,
    });

    expect(markers.get("2037-05-21")).toBe("green");
    expect(computeNoteDates(transactions).has("2037-05-21")).toBe(true);
  });

  it("payday can coexist with a normal activity marker", () => {
    const markers = computeActivityMarkers({
      envelopes: [fictionalLeisure],
      payAnchorIso: anchor,
      transactions: [
        { date: "2037-05-01", amountCents: -1_200, category: "guilt-free", envelopeId: "eat" },
      ],
    });

    expect(markers.get("2037-05-01")).toBe("green");
  });
});
