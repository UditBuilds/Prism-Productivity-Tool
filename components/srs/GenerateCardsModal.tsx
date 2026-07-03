"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Trash2, AlertCircle, RefreshCw } from "lucide-react";

import { useGenerateCards, useSaveGeneratedCards } from "@/hooks/useSRS";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardCountPills } from "@/components/shared/CardCountPills";

const CARD_COUNT_OPTIONS = [5, 8, 10, 15, 20];

type Phase = "idle" | "generating" | "preview" | "saving";

interface DraftCard {
  id: string;
  front: string;
  back: string;
}

export function GenerateCardsModal({
  noteId,
  noteTitle,
  open,
  onClose,
}: {
  noteId: string;
  noteTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const generate = useGenerateCards();
  const save = useSaveGeneratedCards();

  const [phase, setPhase] = useState<Phase>("idle");
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [deckName, setDeckName] = useState(noteTitle);
  const [cardCount, setCardCount] = useState(8);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean idle state every time the modal opens.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setCards([]);
      setDeckName(noteTitle);
      setCardCount(8);
      setError(null);
    }
  }, [open, noteTitle]);

  function handleClose() {
    setPhase("idle");
    setCards([]);
    setError(null);
    onClose();
  }

  async function handleGenerate() {
    setError(null);
    setPhase("generating");
    try {
      const result = await generate.mutateAsync({ noteId, cardCount });
      setCards(
        result.map((c) => ({
          id: crypto.randomUUID(),
          front: c.front,
          back: c.back,
        }))
      );
      setDeckName(noteTitle);
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate cards.");
      setPhase("idle");
    }
  }

  async function handleSave() {
    if (cards.length === 0) return;
    setError(null);
    setPhase("saving");
    const deck = deckName.trim() || noteTitle.trim() || "Default";
    try {
      await save.mutateAsync({
        cards: cards.map((c) => ({
          front: c.front,
          back: c.back,
          deck_name: deck,
          note_id: noteId,
        })),
        deckName: deck,
      });
      handleClose(); // success toast fires in the hook
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save cards.");
      setPhase("preview"); // keep the drafts so the user can retry
    }
  }

  function deleteCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  const busy = phase === "generating" || phase === "saving";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 animate-breathe text-accent" />
            {phase === "preview"
              ? `Review Generated Cards (${cards.length} card${
                  cards.length === 1 ? "" : "s"
                })`
              : "Generate Flashcards from this Note"}
          </DialogTitle>
          {phase === "idle" && (
            <DialogDescription>
              AI will read your note and create spaced repetition cards
              automatically.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Note title badge */}
        {(phase === "idle" || phase === "generating") && (
          <div className="flex">
            <span className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              {noteTitle}
            </span>
          </div>
        )}

        {/* Card count selector */}
        {phase === "idle" && (
          <div className="space-y-2">
            <Label>Number of cards to generate</Label>
            <CardCountPills
              value={cardCount}
              onChange={setCardCount}
              options={CARD_COUNT_OPTIONS}
            />
          </div>
        )}

        {/* Inline error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* GENERATING */}
        {phase === "generating" && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <p className="text-sm">Reading your note with AI…</p>
          </div>
        )}

        {/* SAVING */}
        {phase === "saving" && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <p className="text-sm">Saving cards…</p>
          </div>
        )}

        {/* PREVIEW */}
        {phase === "preview" && (
          <div className="space-y-4">
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {cards.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No cards left. Regenerate or cancel.
                </p>
              ) : (
                cards.map((card) => (
                  <div
                    key={card.id}
                    className="relative rounded-lg border border-border bg-surface p-3 pr-9"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {card.front}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {card.back}
                    </p>
                    <button
                      type="button"
                      aria-label="Remove card"
                      onClick={() => deleteCard(card.id)}
                      className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition hover:bg-surface-raised hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gen-deck">Deck name</Label>
              <Input
                id="gen-deck"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Deck name for these cards"
                className="rounded-lg"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {phase === "preview" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleGenerate}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Regenerate
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={cards.length === 0}
              >
                Save {cards.length} card{cards.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={busy}
                className="w-full sm:w-auto"
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Generate Cards
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
