"use client";

import { useState } from "react";
import { Layers, Pencil, Trash2 } from "lucide-react";

import { useUIStore } from "@/store/ui.store";
import { useAllCards, useDeleteCard } from "@/hooks/useSRS";
import type { SrsCard } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  const openEditCard = useUIStore((s) => s.openEditCard);
  const { data: cards } = useAllCards();
  const deleteCard = useDeleteCard();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const open = manageDeckName !== null;
  const deckCards = (cards ?? []).filter(
    (c) => c.deck_name === manageDeckName
  );

  function handleClose() {
    setConfirmingId(null);
    closeManageDeck();
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
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{manageDeckName}</span>
          </DialogTitle>
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
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
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
