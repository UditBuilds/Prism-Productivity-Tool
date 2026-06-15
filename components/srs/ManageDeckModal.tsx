"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layers, Loader2, Pencil, Trash2 } from "lucide-react";

import { useUIStore } from "@/store/ui.store";
import { useAllCards, useDeleteCard } from "@/hooks/useSRS";
import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { SrsCard } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Per-deck card management: list a deck's cards with edit + delete. Reads the
 * shared ["srs-cards"] cache (no extra fetch) and filters to the deck. Delete
 * uses an inline confirm row (no nested AlertDialog inside this Dialog) and the
 * existing useDeleteCard mutation, which optimistically drops the card and
 * invalidates the cache — so the list and the deck grid behind it update at once.
 */
export function ManageDeckModal() {
  const manageDeckName = useUIStore((s) => s.manageDeckName);
  const closeManageDeck = useUIStore((s) => s.closeManageDeck);
  const openManageDeck = useUIStore((s) => s.openManageDeck);
  const openEditCard = useUIStore((s) => s.openEditCard);
  const { data: cards } = useAllCards();
  const deleteCard = useDeleteCard();
  const qc = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deckConfirm, setDeckConfirm] = useState(false);
  const [deletingDeck, setDeletingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const open = manageDeckName !== null;
  const deckCards = (cards ?? []).filter(
    (c) => c.deck_name === manageDeckName
  );

  function handleClose() {
    setConfirmingId(null);
    setDeckConfirm(false);
    setDeckError(null);
    setRenaming(false);
    setRenameError(null);
    closeManageDeck();
  }

  // Delete every card in this deck in one server call, then refresh the SRS
  // cache and the review-derived read models (deleted cards cascade their
  // srs_reviews). Keeps the modal open on failure so the error stays visible.
  async function handleDeleteDeck() {
    if (!manageDeckName) return;
    setDeletingDeck(true);
    setDeckError(null);
    try {
      const res = await fetch(
        `/api/srs/decks?deckName=${encodeURIComponent(manageDeckName)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as {
        data: { deleted: number } | null;
        error: string | null;
      };
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Delete failed (${res.status})`);
      }
      qc.invalidateQueries({ queryKey: ["srs-cards"] });
      invalidateDerivedCaches(qc, "srs-review");
      handleClose();
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : "Failed to delete deck");
    } finally {
      setDeletingDeck(false);
    }
  }

  function startRename() {
    setRenaming(true);
    setRenameValue(manageDeckName ?? "");
    setRenameError(null);
    setDeckConfirm(false);
  }

  function cancelRename() {
    setRenaming(false);
    setRenameError(null);
  }

  // Rename = bulk deck_name update across the deck's cards. On success, point
  // the modal at the new name (via the store) so the title + card filter follow.
  async function handleSaveRename() {
    if (!manageDeckName) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Deck name can't be empty.");
      return;
    }
    if (trimmed === manageDeckName) {
      setRenameError("Enter a name different from the current one.");
      return;
    }
    setSavingRename(true);
    setRenameError(null);
    try {
      const res = await fetch("/api/srs/decks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName: manageDeckName, newName: trimmed }),
      });
      const json = (await res.json()) as {
        data: { updated: number } | null;
        error: string | null;
      };
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Rename failed (${res.status})`);
      }
      qc.invalidateQueries({ queryKey: ["srs-cards"] });
      openManageDeck(trimmed);
      setRenaming(false);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "Failed to rename deck");
    } finally {
      setSavingRename(false);
    }
  }

  // Editing reuses the shared CardForm dialog; close this one first so the two
  // dialogs don't stack and fight over the focus trap.
  function handleEdit(card: SrsCard) {
    handleClose();
    openEditCard(card);
  }

  function handleDelete(id: string) {
    deleteCard.mutate(id);
    setConfirmingId(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex min-w-0 items-center gap-2">
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{manageDeckName}</span>
            </DialogTitle>

            {deckCards.length > 0 &&
              !renaming &&
              (deckConfirm ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Delete all {deckCards.length} card
                    {deckCards.length === 1 ? "" : "s"}?
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deletingDeck}
                    onClick={() => setDeckConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deletingDeck}
                    onClick={handleDeleteDeck}
                    className="text-destructive hover:text-destructive"
                  >
                    {deletingDeck && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    Delete deck
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="Rename deck"
                    title="Rename deck"
                    onClick={startRename}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-foreground active:scale-95"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete deck"
                    title="Delete deck"
                    onClick={() => {
                      setDeckError(null);
                      setDeckConfirm(true);
                    }}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-danger active:scale-95"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
          </div>

          {/* Inline rename form — no nested dialog (same rule as delete confirm) */}
          {renaming && (
            <div className="mt-3">
              <Input
                autoFocus
                value={renameValue}
                onChange={(e) => {
                  setRenameValue(e.target.value);
                  if (renameError) setRenameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                disabled={savingRename}
                placeholder="Deck name"
                className="h-9 rounded-lg text-sm"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={savingRename}
                  onClick={cancelRename}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={savingRename}
                  onClick={handleSaveRename}
                  className="text-white"
                >
                  {savingRename && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
              {renameError && (
                <p className="mt-2 text-xs text-destructive">{renameError}</p>
              )}
            </div>
          )}

          {deckError && (
            <p className="mt-2 text-xs text-destructive">{deckError}</p>
          )}
        </DialogHeader>

        {deckCards.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No cards left in this deck.
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {deckCards.map((card) => (
              <li
                key={card.id}
                className="rounded-lg border border-border bg-surface-raised/50 px-3 py-2"
              >
                {confirmingId === card.id ? (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                      Delete this card?
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(card.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {card.front}
                    </span>
                    <button
                      type="button"
                      aria-label="Edit card"
                      title="Edit card"
                      onClick={() => handleEdit(card)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-foreground active:scale-95"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete card"
                      title="Delete card"
                      onClick={() => setConfirmingId(card.id)}
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
      </DialogContent>
    </Dialog>
  );
}
