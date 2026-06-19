"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Settings2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useFocusCategories } from "@/hooks/useFocusCategories";
import { CATEGORY_COLORS } from "@/components/focus/category-colors";
import type { FocusCategory } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FOCUS_CATEGORIES_KEY = ["focus-categories"] as const;

/**
 * Read-only-list + per-row edit/delete for the user's focus categories.
 * Controlled by the caller (open/onOpenChange) so it needs no UI store entry.
 * Edit (inline input + swatch picker) and delete (inline confirm — no nested
 * dialog, same rule as ManageDeckModal) both hit the existing
 * /api/focus/categories endpoint and invalidate the shared categories cache.
 */
export function ManageCategoriesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { categories } = useFocusCategories();
  const qc = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(CATEGORY_COLORS[0]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setEditingId(null);
    setConfirmingId(null);
    setError(null);
    setBusy(false);
    onOpenChange(false);
  }

  function startEdit(id: string, label: string, color: string) {
    setConfirmingId(null);
    setError(null);
    setEditingId(id);
    setEditName(label);
    setEditColor(color);
  }

  async function handleSaveEdit(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/focus/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: trimmed, color: editColor }),
      });
      const json = (await res.json()) as {
        data: FocusCategory | null;
        error: string | null;
      };
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Save failed (${res.status})`);
      }
      await qc.invalidateQueries({ queryKey: FOCUS_CATEGORIES_KEY });
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save category");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/focus/categories?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as {
        data: { id: string } | null;
        error: string | null;
      };
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Delete failed (${res.status})`);
      }
      await qc.invalidateQueries({ queryKey: FOCUS_CATEGORIES_KEY });
      setConfirmingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete category");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            Manage categories
          </DialogTitle>
        </DialogHeader>

        {categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No categories yet.
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {categories.map((cat) => (
              <li
                key={cat.id}
                className="rounded-lg border border-border bg-surface-raised/50 px-3 py-2"
              >
                {editingId === cat.id ? (
                  <div>
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        if (error) setError(null);
                      }}
                      disabled={busy}
                      placeholder="Category name"
                      className="h-9 rounded-lg text-sm"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {CATEGORY_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Color ${hex}`}
                          disabled={busy}
                          onClick={() => setEditColor(hex)}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-surface transition",
                            editColor === hex ? "ring-white" : "ring-transparent"
                          )}
                          style={{ backgroundColor: hex }}
                        >
                          {editColor === hex && (
                            <Check className="h-3.5 w-3.5 text-white" />
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy || !editName.trim()}
                        onClick={() => handleSaveEdit(cat.id)}
                        className="text-white"
                      >
                        {busy && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : confirmingId === cat.id ? (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                      Delete &ldquo;{cat.label}&rdquo;? Existing sessions keep
                      this label.
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleDelete(cat.id)}
                    >
                      {busy && (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      )}
                      Delete
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cat.chartColor }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {cat.label}
                    </span>
                    <button
                      type="button"
                      aria-label="Edit category"
                      title="Edit category"
                      onClick={() => startEdit(cat.id, cat.label, cat.chartColor)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-foreground active:scale-95"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete category"
                      title="Delete category"
                      onClick={() => {
                        setError(null);
                        setConfirmingId(cat.id);
                      }}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-danger active:scale-95"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
