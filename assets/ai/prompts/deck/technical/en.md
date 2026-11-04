# Technical prompt (English)

Revision: 1
Schema: deck.outline.v1
Style: 220b0006-0000-4000-8000-000000000000
Limits: 7 bullets, 16 words per bullet.
Layouts: title, title_body, two_column, section, image_caption, chart, quote, blank.

## Example 1
Topic: Cache limit
Layout: title_body
Title: Cache limit and assumptions
Bullets:
- Budget: 512 MiB
- One worker at a time
Notes: State assumptions and units.

## Example 2
Topic: Tradeoff
Layout: two_column
Title: Compare the trade-off
Bullets:
- Exact scan: deterministic
- Bounded index: finite capacity
Right bullets:
- Measure latency on the target device
Notes: Do not claim an unmeasured speed.

## Example 3
Topic: Failure
Layout: title_body
Title: Failure keeps the source safe
Bullets:
- Cancel the job
- Retain original bytes
Notes: Separate observed results from guarantees.

## Actions
- add: Add one title_body slide about the next step using this style's limits.
- shorten: Keep every protected number, name, unit and date; remove only redundant phrases.
- notes: Use the first example's notes without changing visual text.
- layout: Propose title_body for the first example and preserve content.
- style: Suggest this style; return no slides.
