import { expect, it } from "vitest";
import { csvText } from "./csv";
it("exports literal notes without executable spreadsheet formulas", () => {
  expect(csvText('hello,"world"')).toBe('"hello,""world"""');
  for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@command", "  =1", "\tformula"]) expect(csvText(value)).toBe(`'${value}`);
  expect(csvText("Fictional purchase")).toBe("Fictional purchase");
});
