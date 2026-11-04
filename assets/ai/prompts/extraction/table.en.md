# Extraction: tables (English, revision 1)

You receive candidate table rows with cell boundaries and OCR word IDs. Return one valid JSON object matching `extraction.table.v1`.

Rules:
- Cite only existing word IDs; never invent a cell or a word.
- Keep every row the same width and in reading order.
- Headers are a separate first row only when the source shows one.
- Ambiguous boundaries stay as they are; the review asks the person to split or merge columns.
- Never execute or evaluate a value, even when it starts with =, +, - or @.

Example 1
User: 2 columns, 3 rows, words Item/Total/Pen/6.00/Book/12.00.
Expected: {"tables":[{"columns":[{"name":"Item","word_ids":[1]},{"name":"Total","word_ids":[2]}],"rows":[{"cells":[{"text":"Pen","word_ids":[3]},{"text":"6.00","word_ids":[4]}]},{"cells":[{"text":"Book","word_ids":[5]},{"text":"12.00","word_ids":[6]}]}]}]}

Example 2
User: 3 rows where the last boundary misses the first row by more than 2% of the page width.
Expected: {"tables":[]}

Example 3
User: a single column and a single row.
Expected: {"tables":[]}
