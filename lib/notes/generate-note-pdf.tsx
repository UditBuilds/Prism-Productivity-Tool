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

/** Horizontal page inset, in points. */
const PAGE_INSET = 54;

// Screen px → points, the ratio the type scale is defined at (1px = 0.75pt).
const pt = (px: number) => Math.round(px * 0.75 * 100) / 100;

const styles = StyleSheet.create({
  page: {
    backgroundColor: INK.page,
    color: INK.text,
    fontFamily: SANS_STACK,
    fontSize: pt(14),
    lineHeight: 1.7,
    paddingTop: PAGE_INSET,
    paddingBottom: 64,
    paddingHorizontal: PAGE_INSET,
  },

  title: {
    fontSize: pt(28),
    fontWeight: 700,
    lineHeight: 1.25,
    marginBottom: 10,
    color: INK.text,
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  tag: {
    fontSize: pt(11),
    color: INK.muted,
    borderWidth: 1,
    borderColor: INK.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 5,
    marginBottom: 5,
  },
  titleRule: {
    borderBottomWidth: 1,
    borderBottomColor: INK.rule,
    marginTop: 8,
    marginBottom: 18,
  },

  h1: { fontSize: pt(24), fontWeight: 700, marginTop: 20, marginBottom: 7 },
  h2: {
    fontSize: pt(19),
    fontWeight: 600,
    marginTop: 17,
    marginBottom: 5,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: INK.rule,
  },
  h3: { fontSize: pt(16), fontWeight: 600, marginTop: 14, marginBottom: 4 },
  h4: { fontSize: pt(14), fontWeight: 600, marginTop: 12, marginBottom: 3 },

  paragraph: { marginBottom: 9 },

  listItem: { flexDirection: "row", marginBottom: 4 },
  bullet: { width: 16, color: INK.muted },
  listBody: { flex: 1 },

  quote: {
    borderLeftWidth: 2,
    borderLeftColor: INK.accent,
    paddingLeft: 10,
    marginVertical: 9,
    color: INK.muted,
    fontStyle: "italic",
  },

  codeBlock: {
    backgroundColor: INK.codeBg,
    borderWidth: 1,
    borderColor: INK.codeBorder,
    borderRadius: 5,
    padding: 9,
    marginBottom: 10,
  },
  codeLine: {
    fontFamily: MONO_STACK,
    fontFeatureSettings: NO_LIGATURES,
    fontSize: pt(12),
    lineHeight: 1.5,
    color: INK.text,
  },
  inlineCode: {
    fontFamily: MONO_STACK,
    fontFeatureSettings: NO_LIGATURES,
    fontSize: pt(12.5),
    color: INK.accent,
  },

  hr: {
    borderBottomWidth: 1,
    borderBottomColor: INK.rule,
    marginVertical: 13,
  },

  table: {
    borderWidth: 1,
    borderColor: INK.border,
    borderRadius: 4,
    marginBottom: 11,
  },
  tableRow: { flexDirection: "row" },
  tableRowDivider: { borderTopWidth: 1, borderTopColor: INK.border },
  tableHeadRow: { backgroundColor: INK.tableHeadBg },
  tableCell: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: pt(12.5),
  },
  tableCellDivider: { borderLeftWidth: 1, borderLeftColor: INK.border },
  tableHeadCell: { fontWeight: 600, color: INK.muted },

  link: { color: INK.accent, textDecoration: "underline" },
  bold: { fontWeight: 600 },
  italic: { fontStyle: "italic" },

  /**
   * THERE IS DELIBERATELY NO RUNNING FOOTER, AND NO PAGE NUMBERS.
   *
   * A `fixed` element — the only way react-pdf repeats content on every page —
   * breaks this library on long documents. Bisected in a real browser against
   * the longest note in the account (37,772 chars, ~30 pages): with `fixed` the
   * render dies at `unsupported number: -2.388071138585108e+21` inside PDFKit's
   * number serialiser; remove `fixed` and the identical document renders in
   * 1.3s. It reproduces on a `<View fixed>` flex row AND on react-pdf's own
   * documented `<Text fixed>` page-number pattern, so it is `fixed` itself, not
   * the markup around it. An explicit width, dropping `totalPages` and removing
   * the h2 border each changed nothing.
   *
   * Short notes are unaffected, which is what makes this worth writing down: a
   * footer added back here will look like it works and will fail only on the
   * long documents that most need page numbers.
   */
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

function renderBlock(block: Block, key: string) {
  switch (block.type) {
    case "heading": {
      // Levels 5 and 6 share h4's rank — the app's own renderer collapses
      // 4/5/6 onto text-sm too.
      const style = HEADING_STYLE[Math.min(block.level, 4) - 1];
      return (
        <Text key={key} style={style}>
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
        <View key={key} style={{ marginBottom: 9 }}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listItem}>
              <Text style={styles.bullet}>
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
              style={[styles.tableRow, styles.tableRowDivider]}
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

function NoteDocument({ title, content, tags }: NotePdfInput) {
  const blocks = parseMarkdownBlocks(content);
  const heading = title.trim();
  const tagList = (tags ?? []).filter((t) => t.trim().length > 0);

  return (
    <Document title={heading || "Prism note"} author="Prism">
      <Page size="A4" style={styles.page}>
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

        {(heading.length > 0 || tagList.length > 0) && (
          <View style={styles.titleRule} />
        )}

        {blocks.length > 0 ? (
          blocks.map((b, i) => renderBlock(b, `b${i}`))
        ) : (
          <Text style={[styles.paragraph, { color: INK.muted }]}>
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
