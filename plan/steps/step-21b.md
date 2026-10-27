# Step 21b: AI for sheets (★★★★)

**Needs:** 21a, 17a. **Also read:** `plan/ai.md`.

## Tasks
- **"Write a formula that...":** the model proposes a formula; the app calculates it on a copy of the data and shows the result next to it before inserting, and says if it errors.
- **"Explain this formula"** in plain language.
- **"Clean this data":** fix inconsistent dates, extra spaces, duplicates, and mixed number formats, always shown as a preview of changes.
- **"Suggest a chart":** chart type and ranges, rendered by the real chart engine.
- **"Describe this table".**
- Formulas use the sheet's locale (for example `;` separators and Spanish function names when the app is in Spanish).
- Evaluation sets for formula correctness and cleaning accuracy in English and Spanish; results checked with the formula tests.

## Help pages
AI help in spreadsheets.

## Done when
Each action works in English and Spanish on my sample workbooks, every suggested formula is calculated before inserting, and the evaluation scores are in the step report.
