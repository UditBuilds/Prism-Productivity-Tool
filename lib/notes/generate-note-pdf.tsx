/**
 * Note → PDF, entirely client-side.
 *
 * ⚠️ NEVER import this module statically. `@react-pdf/renderer` is a large
 * dependency and the Notes page must not pay for it on first load — every
 * caller reaches it through `await import("@/lib/notes/generate-note-pdf")`
 * inside a click handler, the same lazy-boundary discipline that keeps recharts
 * out of the Learn page's first load. Importing it at module scope anywhere
 * silently undoes that.
 *
 * There is no API route and no server work: generation runs in the browser, so
 * the feature costs nothing on Vercel or Groq and keeps working offline.
 */
import {
  Document,
  Font,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

import {
  parseMarkdownBlocks,
  type Block,
  type InlineNode,
} from "@/lib/markdown-blocks";
import { sanitizeForPdf } from "@/lib/notes/pdf-text";

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * Served from `public/`, not bundled. next-pwa precaches everything under
 * `public/` into the app shell (verified: `public/icons/*` appear in the
 * generated `public/sw.js` precache manifest with revisions), so these are on
 * the device before the first export and PDF generation works offline. Inlining
 * them as base64 would add ~800 KB to a JS chunk to achieve the same thing.
 *
 * `@fontsource/*` cannot be used here: it ships woff2/woff only, and react-pdf's
 * embedder wants TTF/OTF. See public/fonts/pdf/LICENSE.md.
 */
const FONT_DIR = "/fonts/pdf";

const SANS = "InstrumentSans";
const MONO = "JetBrainsMono";
const DEVANAGARI = "NotoSansDevanagari";

/**
 * THE FONT STACK, not a single family. react-pdf v4 accepts an array and does
 * per-glyph substitution, walking to the next family only for codepoints the
 * previous one cannot draw.
 *
 * Devanagari is not decoration. Measured against the live notes table,
 * Instrument Sans lacks a glyph for 60 of the 158 distinct printable characters
 * present — ~4,900 occurrences, almost all Devanagari, concentrated in the
 * longest note in the account. Without the fallback those export as blank
 * boxes, which is worse than not offering the feature.
 */
/**
 * BOTH stacks list all three families, and the order is the only difference.
 * A stack's last entry is reached only for codepoints the earlier ones cannot
 * draw, so this costs nothing visually and buys real coverage: JetBrains Mono
 * carries the maths symbols the corpus uses and Instrument Sans does not
 * (U+2248, U+2264, U+2265), while Noto Sans Devanagari carries the rupee sign.
 *
 * It also means ONE coverage set describes both stacks, which is what
 * `pdf-font-coverage.json` and `sanitizeForPdf` rely on.
 */
const SANS_STACK = [SANS, DEVANAGARI, MONO];
const MONO_STACK = [MONO, DEVANAGARI, SANS];

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;

  // EVERY weight × style slot must resolve or react-pdf THROWS mid-render —
  // it is lenient about weight but not about style, so a missing italic face
  // aborts the whole document rather than degrading. Three ways that bites:
  // a blockquote (italic) containing **bold** asks for italic 600; inline code
  // inside bold asks the mono family for 600; and any italic run at all asks
  // the Devanagari fallback for an italic it does not have. Slots with no real
  // face point at the nearest one that exists.
  const sans = (f: string) => `${FONT_DIR}/InstrumentSans-${f}.ttf`;
  const italic = sans("Italic");

  Font.register({
    family: SANS,
    fonts: [
      { src: sans("Regular"), fontWeight: 400, fontStyle: "normal" },
      { src: sans("SemiBold"), fontWeight: 600, fontStyle: "normal" },
      { src: sans("Bold"), fontWeight: 700, fontStyle: "normal" },
      // Only one italic face was vendored. Keeping the slant and approximating
      // the weight is the better trade: bold-italic is vanishingly rare here,
      // and the slant is the more visible of the two signals.
      { src: italic, fontWeight: 400, fontStyle: "italic" },
      { src: italic, fontWeight: 600, fontStyle: "italic" },
      { src: italic, fontWeight: 700, fontStyle: "italic" },
    ],
  });

  // Single-face families: one file fills the whole matrix. Neither JetBrains
  // Mono nor Noto Sans Devanagari is being asked to look bold or italic — they
  // are there so the glyph exists at all.
  for (const [family, file] of [
    [MONO, "JetBrainsMono-Regular.ttf"],
    [DEVANAGARI, "NotoSansDevanagari-Regular.ttf"],
  ] as const) {
    Font.register({
      family,
      fonts: ([400, 600, 700] as const).flatMap((fontWeight) =>
        (["normal", "italic"] as const).map((fontStyle) => ({
          src: `${FONT_DIR}/${file}`,
          fontWeight,
          fontStyle,
        }))
      ),
    });
  }

  // react-pdf hyphenates by default and breaks ordinary prose mid-word with a
  // hyphen that was never in the source. Returning the word whole disables it.
  Font.registerHyphenationCallback((word) => [word]);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * A LIGHT document that carries the app's typography and Iris accent, rather
 * than a literal screenshot of the dark UI.
 *
 * The app is Graphite & Spectrum on a near-black `#0F1012`; a PDF is a thing
 * you print, attach and read in someone else's viewer, and a full-bleed black
 * page is hostile in all three. What is preserved is what identifies the app on
 * paper: Instrument Sans and JetBrains Mono, the 30/24/16/14/12 type ranks
 * scaled to points, the graphite neutrals, and Iris for links and rules.
 *
 * Every colour is written ONCE here. Flipping this object to the dark tokens is
 * the whole change if that is ever wanted — same pattern as `BLOCK_SURFACE` in
 * SectionPanel.
 */
const INK = {
  page: "#FFFFFF",
  text: "#17181C",
  muted: "#6B6F7B",
  border: "#E3E5EA",
  rule: "#D9DCE3",
  accent: "#5B67EE", // Iris — the brand literal from --accent-rgb.
  codeBg: "#F5F6F8",
  codeBorder: "#E3E5EA",
  tableHeadBg: "#F5F6F8",
  // Added by the design pass, following the existing <element><Role> naming.
  inlineCodeBg: "#F0F1F5", // a shade darker than codeBg so a chip reads on white
  tableStripeBg: "#FAFAFC", // zebra rows: barely there by design, see `table`
  quoteText: "#3F434E", // between text and muted — recedes without going faint
} as const;

/**
 * JetBrains Mono ships programming ligatures, and they CRASH the export.
 *
 * When fontkit applies a `liga`/`calt` substitution -- `//`, `://`, `->`, `=>`,
 * `!=`, `===` -- react-pdf's font embedder throws
 * `Offset is outside the bounds of the DataView` and the whole document fails.
 * Verified in the browser: every one of those sequences fails inside a code
 * span and passes verbatim in sans prose, where no substitution happens. It is
 * not about the characters; it is about the substitution.
 *
 * That made every code block containing a URL unexportable, which is why the
 * longest note in the account could not be exported at all.
 *
 * fontkit reads the object form as an explicit tag->boolean map, so this turns
 * the ligature features off rather than merely not requesting them.
 */
const NO_LIGATURES = {
  liga: false, // standard ligatures
  clig: false, // contextual ligatures
  dlig: false, // discretionary ligatures
  calt: false, // contextual alternates -- what JetBrains Mono actually uses
} as const;

/**
 * ONE SPACING SCALE, base 4pt. Every margin and padding in this file is a
 * member of it.
 *
 * The first version of this document used 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
 * 13, 14, 17, 18 and 20 — sixteen values chosen one at a time. Nothing was
 * individually wrong and the whole read as arbitrary, because unequal gaps
 * that carry no meaning are exactly what "undesigned" looks like. A closed set
 * is what makes the rhythm legible.
 *
 * Radii are deliberately NOT on this scale: they are shape, not rhythm, and a
 * 4pt corner on a 9pt chip would swallow it. They live in `RADIUS`.
 */
const BASE = 4;
const SPACE = {
  xs: BASE, // 4
  sm: BASE * 2, // 8
  md: BASE * 3, // 12
  lg: BASE * 4, // 16
  xl: BASE * 6, // 24
  xxl: BASE * 8, // 32
} as const;

/**
 * The list marker gutter. On the base unit but not one of the named steps:
 * 16 clips "10." at body size and 24 leaves a bullet stranded halfway across
 * the page, so this is the one width that has to be measured rather than
 * chosen from the ramp.
 */
const LIST_GUTTER = BASE * 5; // 20

const RADIUS = { chip: 3, panel: 4, pill: 999 } as const;

/**
 * Type scale in POINTS, the unit a page is actually measured in.
 *
 * The app's own scale is in px and this used to be derived from it through a
 * `pt(px)` helper. That indirection stopped paying: the sizes a printed page
 * wants are not the sizes a 375px phone wants, and every value had to be
 * back-solved through a multiplication to be read. The ranks still correspond
 * to the app's — masthead / h1 / h2 / h3 / body / meta — they are just stated
 * directly now.
 *
 * Ratio is roughly 1.2 between adjacent ranks, which is what keeps h2 and h3
 * distinguishable at a glance; the previous scale put them 3pt apart and they
 * read as one rank.
 */
const TYPE = {
  masthead: 22,
  h1: 17,
  h2: 14.5,
  h3: 12,
  h4: 10.5,
  body: 10.5,
  small: 8.5, // tag pills, the "Exported from" line
  code: 9,
  inlineCode: 9,
} as const;

/**
 * Page margins.
 *
 * 64pt sides rather than the 54 this shipped with. A4 is 595pt wide, so 54pt
 * insets leave a 487pt measure — around 95 characters at 10.5pt, well past the
 * 45–75 that reads comfortably. 64 brings it to 467pt / ~88 characters: still
 * generous, but the page now has a margin you can see rather than a text block
 * that runs to the edges. Going further starts to look like a pamphlet.
 *
 * Bottom is deeper than top so the text block sits slightly high on the page,
 * which is the conventional optical centre — a mathematically centred block
 * reads as low.
 */
const PAGE = { top: 56, bottom: 64, side: 64 } as const;

const styles = StyleSheet.create({
  page: {
    backgroundColor: INK.page,
    color: INK.text,
    fontFamily: SANS_STACK,
    fontSize: TYPE.body,
    // 1.5 rather than the 1.7 this shipped with. 1.7 is a screen value; on
    // paper at 10.5pt it opens the lines far enough that paragraphs stop
    // cohering into blocks.
    lineHeight: 1.5,
    paddingTop: PAGE.top,
    paddingBottom: PAGE.bottom,
    paddingHorizontal: PAGE.side,
  },

  // -- Masthead (page 1 only; it is ordinary flow content, not `fixed`) ------
  //
  // This document has no running footer — `fixed` breaks react-pdf on long
  // documents, see the comment where the footer used to be — so the masthead
  // is the only place the page can say what it is and where it came from. It
  // carries that weight: title, tags, provenance line, rule.
  masthead: { marginBottom: SPACE.xl },
  title: {
    fontSize: TYPE.masthead,
    fontWeight: 700,
    lineHeight: 1.2,
    color: INK.text,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: SPACE.md,
    // Rows of pills need their own gap; marginBottom on the pill would also
    // pad the last row, so the row carries a negative offset instead.
    marginBottom: -SPACE.xs,
  },
  tag: {
    fontSize: TYPE.small,
    color: INK.muted,
    borderWidth: 0.5,
    borderColor: INK.border,
    borderRadius: RADIUS.pill,
    backgroundColor: INK.codeBg,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    marginRight: SPACE.xs,
    marginBottom: SPACE.xs,
  },
  provenance: {
    fontSize: TYPE.small,
    color: INK.muted,
    marginTop: SPACE.md,
  },
  mastheadRule: {
    borderBottomWidth: 0.5,
    borderBottomColor: INK.rule,
    marginTop: SPACE.md,
  },

  // -- Headings -------------------------------------------------------------
  //
  // Space above is 2–3x space below throughout. That asymmetry is the whole
  // mechanism: a heading that is closer to its own body than to the section
  // before it groups the two by proximity, without a rule or a colour. Equal
  // gaps above and below — what this had — leave every block floating
  // separately, which is why the first version read as a list of fragments.
  h1: {
    fontSize: TYPE.h1,
    fontWeight: 700,
    marginTop: SPACE.xl,
    marginBottom: SPACE.sm,
  },
  // The hairline under h2 is not decoration: it is the app's own vocabulary
  // (`.prose-preview h2` carries a border-bottom) and it is what keeps h2 and
  // h3 apart. Size alone was not enough — at 14.5 and 12 they read as one rank
  // in a document that uses both heavily.
  h2: {
    fontSize: TYPE.h2,
    fontWeight: 700,
    marginTop: SPACE.xl,
    marginBottom: SPACE.sm,
    paddingBottom: SPACE.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: INK.rule,
  },
  h3: {
    fontSize: TYPE.h3,
    fontWeight: 600,
    marginTop: SPACE.lg,
    marginBottom: SPACE.sm,
  },
  h4: {
    fontSize: TYPE.h4,
    fontWeight: 600,
    color: INK.muted,
    marginTop: SPACE.md,
    marginBottom: SPACE.xs,
  },

  paragraph: { marginBottom: SPACE.md },

  // -- Lists ----------------------------------------------------------------
  list: { marginBottom: SPACE.md },
  listItem: { flexDirection: "row", marginBottom: SPACE.xs },
  // A fixed-width gutter is what produces a hanging indent: the body column
  // starts at the same x whether the marker is a bullet or "10.", so wrapped
  // lines align under the text rather than under the marker.
  marker: {
    width: LIST_GUTTER,
    color: INK.accent,
    fontSize: TYPE.body,
    // The bullet glyph is small and the accent is mid-tone, so at 9-10pt an
    // unweighted marker disappears next to the text it is meant to index.
    fontWeight: 700,
  },
  listBody: { flex: 1 },

  // -- Blockquote -----------------------------------------------------------
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: INK.accent,
    paddingLeft: SPACE.md,
    marginTop: SPACE.xs,
    marginBottom: SPACE.md,
    color: INK.quoteText,
    fontStyle: "italic",
  },

  // -- Code -----------------------------------------------------------------
  codeBlock: {
    backgroundColor: INK.codeBg,
    borderWidth: 0.5,
    borderColor: INK.codeBorder,
    borderRadius: RADIUS.panel,
    padding: SPACE.md,
    marginBottom: SPACE.md,
  },
  codeLine: {
    fontFamily: MONO_STACK,
    fontFeatureSettings: NO_LIGATURES,
    fontSize: TYPE.code,
    lineHeight: 1.45,
    color: INK.text,
  },
  // The chip is what makes inline code read as code. Before this it was only
  // a colour change, which at 9pt disappears into the sentence.
  inlineCode: {
    fontFamily: MONO_STACK,
    fontFeatureSettings: NO_LIGATURES,
    fontSize: TYPE.inlineCode,
    color: INK.accent,
    backgroundColor: INK.inlineCodeBg,
    borderRadius: RADIUS.chip,
    paddingHorizontal: 2,
  },

  hr: {
    borderBottomWidth: 0.5,
    borderBottomColor: INK.rule,
    marginTop: SPACE.sm,
    marginBottom: SPACE.lg,
  },

  // -- Tables ---------------------------------------------------------------
  //
  // Zebra striping was tried against the 5-row and the 26-page fixtures and
  // kept: at 0.5pt the internal rules are almost invisible on paper, so on a
  // long table the eye loses the row. The tint is deliberately near-white —
  // enough to track a row across four columns, not enough to read as a
  // highlight.
  table: {
    borderWidth: 0.5,
    borderColor: INK.border,
    borderRadius: RADIUS.panel,
    marginBottom: SPACE.md,
  },
  tableRow: { flexDirection: "row" },
  tableRowDivider: { borderTopWidth: 0.5, borderTopColor: INK.border },
  tableStripe: { backgroundColor: INK.tableStripeBg },
  // react-pdf does not clip a child to its parent's border radius, so a square
  // header block inside a rounded panel shows two hard corners poking past the
  // curve. Per-corner radii on the header itself are the fix.
  tableHeadRow: {
    backgroundColor: INK.tableHeadBg,
    borderTopLeftRadius: RADIUS.panel,
    borderTopRightRadius: RADIUS.panel,
  },
  tableCell: {
    flex: 1,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.sm,
    fontSize: TYPE.small,
    lineHeight: 1.4,
  },
  tableCellDivider: { borderLeftWidth: 0.5, borderLeftColor: INK.border },
  tableHeadCell: { fontWeight: 700, color: INK.text },

  /**
   * THERE IS DELIBERATELY NO RUNNING FOOTER, AND NO PAGE NUMBERS.
   *
   * A `fixed` element — the only way react-pdf repeats content on every page —
   * breaks this library on long documents. Bisected in a real browser against
   * the longest note in the account (37,772 chars, ~27 pages): with `fixed` the
   * render dies at `unsupported number: -2.388071138585108e+21` inside PDFKit's
   * number serialiser; remove `fixed` and the identical document renders. It
   * reproduces on a `<View fixed>` flex row AND on react-pdf's own documented
   * `<Text fixed>` page-number pattern, so it is `fixed` itself, not the markup
   * around it. An explicit width, dropping `totalPages` and removing the h2
   * border each changed nothing.
   *
   * Short notes are unaffected, which is what makes this worth writing down: a
   * footer added back here will look like it works and will fail only on the
   * long documents that most need page numbers.
   *
   * The masthead carries the provenance this footer would otherwise have.
   */

  link: { color: INK.accent, textDecoration: "underline" },
  bold: { fontWeight: 600 },
  italic: { fontStyle: "italic" },
  emptyBody: { color: INK.muted, fontStyle: "italic" },
});

// ---------------------------------------------------------------------------
// Inline + block rendering
// ---------------------------------------------------------------------------

/**
 * Inline nodes become nested <Text> runs. react-pdf inherits text styles down
 * the tree, so a bold link inside a list item composes without special cases.
 */
function renderInline(nodes: InlineNode[], keyPrefix: string) {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return <Text key={key}>{sanitizeForPdf(node.value)}</Text>;
      case "code":
        return (
          <Text key={key} style={styles.inlineCode}>
            {sanitizeForPdf(node.value)}
          </Text>
        );
      case "bold":
        return (
          <Text key={key} style={styles.bold}>
            {renderInline(node.children, key)}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={styles.italic}>
            {renderInline(node.children, key)}
          </Text>
        );
      case "link":
        return (
          <Link key={key} src={node.href} style={styles.link}>
            {renderInline(node.children, key)}
          </Link>
        );
      default:
        return null;
    }
  });
}

const HEADING_STYLE = [styles.h1, styles.h2, styles.h3, styles.h4] as const;

/**
 * `isFirst` zeroes the top margin of the opening block.
 *
 * Headings carry 24pt above them to separate sections, and the masthead
 * carries its own margin below the rule. On a note that opens with a heading
 * — which is most of them — those two stack into a ~48pt void that reads as a
 * mistake. Same rule as CSS's `:first-child { margin-top: 0 }`.
 */
function renderBlock(block: Block, key: string, isFirst = false) {
  const noTopMargin = isFirst ? { marginTop: 0 } : undefined;
  switch (block.type) {
    case "heading": {
      // Levels 5 and 6 share h4's rank — the app's own renderer collapses
      // 4/5/6 onto text-sm too.
      const style = HEADING_STYLE[Math.min(block.level, 4) - 1];
      return (
        <Text key={key} style={[style, noTopMargin]}>
          {renderInline(block.content, key)}
        </Text>
      );
    }

    case "paragraph":
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(block.content, key)}
        </Text>
      );

    case "quote":
      return (
        <View key={key} style={styles.quote}>
          <Text>{renderInline(block.content, key)}</Text>
        </View>
      );

    case "hr":
      return <View key={key} style={styles.hr} />;

    case "list":
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listItem}>
              <Text style={styles.marker}>
                {block.ordered ? `${i + 1}.` : "•"}
              </Text>
              <Text style={styles.listBody}>
                {renderInline(item, `${key}-${i}`)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "code":
      // Split by line so a long block can break across pages at a line
      // boundary; one <Text> holding newlines would be atomic.
      return (
        <View key={key} style={styles.codeBlock}>
          {block.value.split("\n").map((line, i) => (
            <Text key={`${key}-${i}`} style={styles.codeLine}>
              {line.length > 0 ? sanitizeForPdf(line) : " "}
            </Text>
          ))}
        </View>
      );

    case "table": {
      // react-pdf has no table primitive. Columns are equal-width flex cells;
      // rows carry the horizontal rules and every cell after the first carries
      // the vertical one, so the grid closes without double borders.
      const colCount = Math.max(
        block.header.length,
        ...block.rows.map((r) => r.length),
        1
      );
      const pad = <T,>(row: T[], filler: T) =>
        row.length >= colCount
          ? row.slice(0, colCount)
          : [...row, ...Array<T>(colCount - row.length).fill(filler)];

      return (
        <View key={key} style={styles.table}>
          {block.header.length > 0 && (
            <View style={[styles.tableRow, styles.tableHeadRow]} wrap={false}>
              {pad(block.header, [] as InlineNode[]).map((cell, c) => (
                <Text
                  key={`${key}-h-${c}`}
                  style={[
                    styles.tableCell,
                    styles.tableHeadCell,
                    ...(c > 0 ? [styles.tableCellDivider] : []),
                  ]}
                >
                  {renderInline(cell, `${key}-h-${c}`)}
                </Text>
              ))}
            </View>
          )}
          {block.rows.map((row, r) => (
            <View
              key={`${key}-r-${r}`}
              style={[
                styles.tableRow,
                styles.tableRowDivider,
                ...(r % 2 === 1 ? [styles.tableStripe] : []),
              ]}
              wrap={false}
            >
              {pad(row, [] as InlineNode[]).map((cell, c) => (
                <Text
                  key={`${key}-r-${r}-${c}`}
                  style={[
                    styles.tableCell,
                    ...(c > 0 ? [styles.tableCellDivider] : []),
                  ]}
                >
                  {renderInline(cell, `${key}-r-${r}-${c}`)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export type NotePdfInput = {
  title: string;
  content: string;
  tags?: string[] | null;
};

/**
 * Today's date in IST, e.g. "2 September 2026".
 *
 * Asia/Kolkata explicitly, not the browser's zone: everything user-visible in
 * this app is IST-anchored (see lib/date.ts), and a note exported at 01:00 IST
 * would otherwise be stamped with yesterday for anyone whose device sits west
 * of it.
 */
function exportedOnIst(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function NoteDocument({ title, content, tags }: NotePdfInput) {
  const blocks = parseMarkdownBlocks(content);
  const heading = title.trim();
  const tagList = (tags ?? []).filter((t) => t.trim().length > 0);

  return (
    <Document title={heading || "Prism note"} author="Prism">
      <Page size="A4" style={styles.page}>
        {/* Masthead. Ordinary flow content, so it appears on page 1 only —
            repeating it would need `fixed`, which breaks long documents. */}
        <View style={styles.masthead}>
          {heading.length > 0 && (
            <Text style={styles.title}>{sanitizeForPdf(heading)}</Text>
          )}

          {tagList.length > 0 && (
            <View style={styles.tagRow}>
              {tagList.map((tag) => (
                <Text key={tag} style={styles.tag}>
                  #{sanitizeForPdf(tag)}
                </Text>
              ))}
            </View>
          )}

          <Text style={styles.provenance}>
            Exported from Prism &middot; {exportedOnIst()}
          </Text>

          <View style={styles.mastheadRule} />
        </View>

        {blocks.length > 0 ? (
          blocks.map((b, i) => renderBlock(b, `b${i}`, i === 0))
        ) : (
          <Text style={[styles.paragraph, styles.emptyBody]}>
            This note is empty.
          </Text>
        )}
      </Page>
    </Document>
  );
}

/** Render a note to a PDF Blob. */
export async function generateNotePdfBlob(note: NotePdfInput): Promise<Blob> {
  registerFonts();
  return pdf(<NoteDocument {...note} />).toBlob();
}
