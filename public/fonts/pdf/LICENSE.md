# PDF export fonts

Static TTF faces used **only** by the client-side note → PDF export
(`lib/notes/pdf-document.tsx`). They are deliberately separate from the app's
own webfonts: `next/font/google` serves variable **woff2**, and
`@react-pdf/renderer`'s font embedder wants static **TTF/OTF**, so the same
two typefaces have to ship twice in two formats.

They live in `public/` rather than being imported into the JS bundle so that
next-pwa precaches them into the app shell (verified: `public/icons/*` already
appear in the generated `public/sw.js` precache manifest with revisions).
That keeps PDF export working offline without adding ~800 KB of base64 to a
client chunk.

| File | Family | Weight / style | Source package |
|---|---|---|---|
| `InstrumentSans-Regular.ttf` | Instrument Sans | 400 | `@expo-google-fonts/instrument-sans@0.4.2` |
| `InstrumentSans-Italic.ttf` | Instrument Sans | 400 italic | same |
| `InstrumentSans-SemiBold.ttf` | Instrument Sans | 600 | same |
| `InstrumentSans-Bold.ttf` | Instrument Sans | 700 | same |
| `JetBrainsMono-Regular.ttf` | JetBrains Mono | 400 | `@expo-google-fonts/jetbrains-mono@0.4.1` |
| `NotoSansDevanagari-Regular.ttf` | Noto Sans Devanagari | 400 | `@expo-google-fonts/noto-sans-devanagari@0.4.1` |

The `@expo-google-fonts/*` packages are used purely as a versioned delivery
channel for the upstream Google Fonts TTFs — none of them is a dependency of
this app, and no Expo runtime code is imported. `@fontsource/*` was checked
first and rejected: it ships **only** woff2/woff, zero TTF.

## Why Noto Sans Devanagari is here

Neither Instrument Sans nor JetBrains Mono has any Devanagari coverage, and
real notes in this app are Hinglish. Measured against the live `notes` table,
Instrument Sans lacks a glyph for 60 of the 158 distinct printable characters
present. Without this fallback face those render as blank boxes in the PDF.
It is registered as the last entry in the `fontFamily` stack, so
`@react-pdf/renderer`'s per-glyph font substitution only reaches for it on
codepoints the Latin faces cannot draw.

## Licences

All three families are licensed under the **SIL Open Font License 1.1**, which
permits bundling and redistribution as part of an application:

- Instrument Sans — OFL-1.1, © 2022 The Instrument Sans Project Authors
  <https://github.com/Instrument/instrument-sans>
- JetBrains Mono — OFL-1.1, © 2020 The JetBrains Mono Project Authors
  <https://github.com/JetBrains/JetBrainsMono>
- Noto Sans Devanagari — OFL-1.1, © 2022 The Noto Project Authors
  <https://github.com/notofonts/devanagari>

Full licence text: <https://openfontlicense.org/>
