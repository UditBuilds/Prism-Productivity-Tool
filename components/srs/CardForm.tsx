"use client";

import { useEffect, useState } from "react";

import { useUIStore } from "@/store/ui.store";
import { useCreateCard, useUpdateCard } from "@/hooks/useSRS";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function CardForm() {
  const { cardDialogOpen, editingCard, closeCardDialog } = useUIStore();
  const createCard = useCreateCard();
  const updateCard = useUpdateCard();

  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deckName, setDeckName] = useState("Default");
  const [errors, setErrors] = useState<{ front?: boolean; back?: boolean }>({});

  useEffect(() => {
    if (!cardDialogOpen) return;
    setErrors({});
    if (editingCard) {
      setFront(editingCard.front);
      setBack(editingCard.back);
      setDeckName(editingCard.deck_name);
    } else {
      setFront("");
      setBack("");
      setDeckName("Default");
    }
  }, [cardDialogOpen, editingCard]);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmedFront = front.trim();
    const trimmedBack = back.trim();
    const nextErrors = { front: !trimmedFront, back: !trimmedBack };
    if (nextErrors.front || nextErrors.back) {
      setErrors(nextErrors);
      return;
    }

    const deck = deckName.trim() || "Default";

    if (editingCard) {
      updateCard.mutate({
        id: editingCard.id,
        front: trimmedFront,
        back: trimmedBack,
        deck_name: deck,
      });
    } else {
      createCard.mutate({
        front: trimmedFront,
        back: trimmedBack,
        deck_name: deck,
      });
    }
    closeCardDialog();
  }

  // Ctrl/Cmd+Enter saves from anywhere in the form.
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Dialog
      open={cardDialogOpen}
      onOpenChange={(open) => !open && closeCardDialog()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingCard ? "Edit card" : "New card"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="card-front">Front</Label>
            <Textarea
              id="card-front"
              value={front}
              onChange={(e) => {
                setFront(e.target.value);
                if (errors.front) setErrors((p) => ({ ...p, front: false }));
              }}
              placeholder="Question or concept…"
              rows={3}
              autoFocus
              className="rounded-lg font-mono text-sm"
            />
            {errors.front && (
              <p className="text-xs text-danger">Front is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="card-back">Back</Label>
            <Textarea
              id="card-back"
              value={back}
              onChange={(e) => {
                setBack(e.target.value);
                if (errors.back) setErrors((p) => ({ ...p, back: false }));
              }}
              placeholder="Answer or explanation…"
              rows={3}
              className="rounded-lg font-mono text-sm"
            />
            {errors.back && (
              <p className="text-xs text-danger">Back is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="card-deck">Deck name</Label>
            <Input
              id="card-deck"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder="e.g. Meta Ads, Biology, Coding"
              className="rounded-lg"
            />
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between sm:gap-2">
            <span className="hidden text-xs text-muted-foreground sm:block">
              Ctrl+Enter to save
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={closeCardDialog}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
