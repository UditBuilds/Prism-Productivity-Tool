# Prism design system

Status: approved 8 October 2026. Replaces "Graphite & Spectrum" one screen at a time.
A screen keeps its old layout until its own PR migrates it.

Dark is the default until the main screens are migrated. Light and System are opt-in.

## Principles
1. One column. Every block on a screen shares the same left and right edge.
2. One shape for every block: a round icon, a bold name, a small grey line, then content.
3. Rows spread evenly across the full width. Nothing hugs one side.
4. Headlines are bold sans. Only long reading text uses the serif.
5. Controls float: round buttons, pill buttons, a pill tab bar.
6. Few boxes. Hairlines separate blocks. A filled panel is for one thing per screen.
7. One accent colour. Red, green and amber only carry meaning.

## Colour tokens
Token names are unchanged. Dark values are the existing ones.

| Token | Light | Dark | Used for |
|---|---|---|---|
| background | #FFFFFF | #0F1012 | the page |
| foreground | #15171C | #EDEEF2 | main text |
| surface | #F6F7F9 | #17181C | floating bars, cards |
| surface-raised | #F1F2F5 | #1E2025 | round buttons, quiet fills |
| border | #E9EBEF | #272930 | hairlines between blocks |
| border-col | #D9DCE3 | #32353E | control outlines |
| input | #C9CDD6 | #32353E | input and secondary-button outlines |
| muted-foreground | #5C6270 | #A2A7B3 | grey text |
| accent | #4350D9 | #5B67EE | primary buttons, links |
| accent-hover | #3440B8 | #6F79F0 | pressed and hover |
| accent-tint (new) | #EEF0FE | #1C1F3A | icon circles, the one filled panel |
| danger | #C2362F | #E45A53 | overdue, errors |
| success | #1F7A4D | #56B881 | correct, done |
| warning | #9A4608 | #E9B449 | not quite, caution |

Text on an accent fill is #FFFFFF in both modes.
Accent used as text in dark mode is accent-soft (#949CF4).
Every text colour reaches 4.5:1 on background and on surface.

## Type
Families: Instrument Sans (interface), Newsreader (reading text, added with the learning
screens), JetBrains Mono (code only).

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Display | 28 / 32 | 700 | -0.02em |
| Title | 24 / 28 | 700 | -0.02em |
| Figure | 26 / 30 | 700 | -0.02em |
| Block name | 15 / 20 | 700 | 0 |
| Body | 16 / 22 | 500 | 0 |
| Meta | 13 / 18 | 400 | 0 |
| Eyebrow | 11 / 16, capitals | 700 | 0.08em |
| Reading | 18 / 29, serif | 400 | 0 |

## Space and shape
- Page margin 16. Reading margin 20.
- Inside a block: 4, 8, 12, 14, 16. Between blocks: a hairline with 16 above and below.
- Radius: full pill for buttons and the tab bar, 16 for panels and inputs, 10 for chips.
- Round icon 36. Round button 44. Every tap target is at least 44.
- Floating controls: surface fill, a 1px border-col outline and one soft shadow.

## Components
- Block header: 36 round icon, bold name, grey line, optional action on the right.
- Counter row: equal columns, centred, figure above label, no box.
- Primary button: accent pill, 48 to 52 tall, full width.
- Secondary button: outlined pill, same height.
- Capture bar: floating pill above the tab bar, with a round add button on the right.
- Tab bar: floating pill, five equal tabs, the active tab on an accent-tint pill.
- Progress: equal segments, 6 tall, filled with accent.
- Verdict badge: tinted pill with an icon and two words. Never colour alone.
- Quote box: accent-tint panel, serif italic.

## Motion
Defined with the first migrated screen. Rules that already hold: transform and opacity
only, about 200ms ease-out, and prefers-reduced-motion is respected.

## Migration status
| Screen | Status |
|---|---|
| Colours and theme switch | PR 1 |
| Learning: lesson, question, feedback | planned |
| Dashboard | planned |
| Tasks, Notes, Workout, Learn, others | planned |
