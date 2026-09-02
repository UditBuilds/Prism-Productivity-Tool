"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import {
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Share2,
} from "lucide-react";

import { noteToMarkdown, pdfFilename } from "@/lib/notes/note-export";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Copy / Share / Export PDF for one note, as a "···" menu matching NoteCard's.
 *
 * Everything here is client-side: the clipboard and share calls are browser
 * APIs, and the PDF is generated in-page. No API route, no server cost.
 */

/**
 * `navigator.share` is absent on desktop Chrome/Firefox and on any non-secure
 * origin. The Share item is then NOT RENDERED rather than rendered disabled —
 * a permanently greyed-out row teaches the user nothing.
 *
 * Read lazily on each open rather than once at module scope so the value can't
 * be captured during SSR, where `navigator` does not exist at all.
 */
function canShareText(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/** Feature-detect file sharing for a specific file. iOS supports it; most desktop browsers do not. */
function canShareFile(file: File): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

/**
 * A share sheet the user dismissed is not a failure. Safari and Chrome both
 * reject with AbortError; surfacing that as an error toast — or falling through
 * to a download the user just declined — would punish them for changing their
 * mind.
 */
function isUserCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Save a blob via a synthetic anchor, revoking the object URL afterwards. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type PdfState = "idle" | "working";

export function NoteActionsMenu({
  title,
  content,
  tags,
}: {
  title: string;
  content: string;
  tags?: string[] | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pdfState, setPdfState] = useState<PdfState>("idle");

  const text = noteToMarkdown(title, content);
  const hasContent = text.trim().length > 0;

  async function handleCopy() {
    // Guard rather than assume: clipboard is undefined on insecure origins,
    // and writeText rejects when the document isn't focused or permission is
    // denied. Either way the user gets told, never silence.
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Note copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — clipboard permission denied");
    }
  }

  async function handleShare() {
    try {
      await navigator.share({
        // No `url`: notes have no public web route, so there is nothing to
        // link to. This is a content share, not a link share.
        title: title.trim() || "Prism note",
        text,
      });
    } catch (err) {
      if (isUserCancellation(err)) return;
      toast.error("Couldn't open the share sheet");
    }
  }

  async function handleExportPdf() {
    if (pdfState === "working") return;
    setPdfState("working");
    try {
      // Lazy so @react-pdf/renderer never lands in the Notes page chunk.
      const { generateNotePdfBlob } = await import(
        "@/lib/notes/generate-note-pdf"
      );
      const blob = await generateNotePdfBlob({ title, content, tags });
      const filename = pdfFilename(title);
      const file = new File([blob], filename, { type: "application/pdf" });

      // Prefer the share sheet where it takes files — on an installed iOS PWA
      // that is the path that reliably reaches Files / Mail / AirDrop, whereas
      // an <a download> in standalone mode behaves poorly.
      if (canShareFile(file)) {
        try {
          await navigator.share({ files: [file], title: title.trim() || filename });
          return;
        } catch (err) {
          if (isUserCancellation(err)) return;
          // Anything else — most likely the transient-activation window
          // expiring while a long note rendered — falls through to a download
          // so the user still ends up with the PDF.
        }
      }
      downloadBlob(blob, filename);
    } catch {
      toast.error("Couldn't create the PDF");
    } finally {
      setPdfState("idle");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Note actions"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
        >
          {pdfState === "working" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={!hasContent}
          onSelect={handleCopy}
        >
          {copied ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </DropdownMenuItem>

        {canShareText() && (
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={!hasContent}
            onSelect={handleShare}
          >
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          className="cursor-pointer"
          disabled={pdfState === "working"}
          onSelect={(e) => {
            // Keep the menu mounted while the PDF renders so the spinner is
            // visible and a second tap can't start a parallel render.
            e.preventDefault();
            void handleExportPdf();
          }}
        >
          {pdfState === "working" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : canShareText() ? (
            <FileText className="mr-2 h-4 w-4" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {pdfState === "working" ? "Preparing…" : "Export PDF"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
