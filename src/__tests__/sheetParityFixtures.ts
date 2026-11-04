/** Coordinator evaluates these with the owner-approved real engine, never a UI evaluator. */
export const sheetParityFixtures = [
  { formula: "=SUM(1,2)", expected: 3 },
  { formula: "=AVERAGE(2,4)", expected: 3 },
  { formula: "=MIN(2,4)", expected: 2 },
  { formula: "=MAX(2,4)", expected: 4 },
  { formula: '=COUNT(2,"a",4)', expected: 2 },
  { formula: '=COUNTA(2,"a",4)', expected: 3 },
  { formula: "=IF(TRUE,2,4)", expected: 2 },
  { formula: "=IF(FALSE,2,4)", expected: 4 },
  { formula: "=AND(TRUE,FALSE)", expected: false },
  { formula: "=OR(TRUE,FALSE)", expected: true },
  { formula: "=NOT(TRUE)", expected: false },
  { formula: "=ROUND(1.25,1)", expected: 1.3 },
] as const;

export const sheetRangeParityFixtures = [
  { formula: '=SUMIF(A1:A3,"A",B1:B3)', cells: [["A", 2], ["B", 3], ["A", 5]], expected: 7 },
  { formula: '=COUNTIF(A1:A3,"A")', cells: [["A", 2], ["B", 3], ["A", 5]], expected: 2 },
  { formula: '=VLOOKUP("B",A1:B3,2,FALSE)', cells: [["A", 2], ["B", 3], ["A", 5]], expected: 3 },
  { formula: "=INDEX(B1:B3,2)", cells: [["A", 2], ["B", 3], ["A", 5]], expected: 3 },
  { formula: '=MATCH("B",A1:A3,0)', cells: [["A", 2], ["B", 3], ["A", 5]], expected: 2 },
] as const;

export const sheetDateParityFixtures = [
  { date_system: "1900", formula: "=DATE(2026,11,2)", expected_iso_date: "2026-11-02" },
  { date_system: "1904", formula: "=DATE(2026,11,2)", expected_iso_date: "2026-11-02" },
  { date_system: "1900", formula: "=TODAY()", injected_local_date: "2026-11-02", expected_iso_date: "2026-11-02" },
  { date_system: "1904", formula: "=TODAY()", injected_local_date: "2026-11-02", expected_iso_date: "2026-11-02" },
] as const;
