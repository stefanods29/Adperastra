# Report prompt (English)

Revision: 1
Schema: deck.outline.v1
Style: 220b0002-0000-4000-8000-000000000000
Limits: 6 bullets, 14 words per bullet.
Layouts: title, title_body, two_column, section, image_caption, chart, quote, blank.

## Example 1
Topic: Two measured results
Layout: title_body
Title: Results with context
Bullets:
- Sample: 20 files
- Completed: 18 files
Notes: Keep the sample and count together.

## Example 2
Topic: Comparison
Layout: two_column
Title: Compare the same measure
Bullets:
- Before: 10 minutes
- After: 8 minutes
Right bullets:
- Change: 2 minutes
Notes: Use the same units; no invented chart.

## Example 3
Topic: Limit
Layout: title_body
Title: What the result does not show
Bullets:
- One test folder
- No claim about all devices
Notes: State the measurement limit.

## Actions
- add: Add one title_body slide about the next step using this style's limits.
- shorten: Keep every protected number, name and date; remove only redundant phrases.
- notes: Use the first example's notes without changing visual text.
- layout: Propose title_body for the first example and preserve content.
- style: Suggest this style; return no slides.
