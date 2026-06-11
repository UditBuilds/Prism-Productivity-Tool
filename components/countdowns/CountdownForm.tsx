"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useCreateCountdown } from "@/hooks/useCountdowns";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const EMOJI_PRESETS = ["🎯", "📅", "🎓", "💼", "✈️", "🎂", "🏆", "⏰"];

export function CountdownForm({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createCountdown = useCreateCountdown();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [emoji, setEmoji] = useState("🎯");
  const [errors, setErrors] = useState<{ title?: boolean; date?: boolean }>(
    {}
  );

  useEffect(() => {
    if (open) {
      setTitle("");
      setDate(undefined);
      setEmoji("🎯");
      setErrors({});
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    const nextErrors = { title: !trimmed, date: !date };
    if (nextErrors.title || nextErrors.date) {
      setErrors(nextErrors);
      return;
    }

    createCountdown.mutate({
      title: trimmed,
      target_date: format(date as Date, "yyyy-MM-dd"),
      emoji,
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New countdown</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="countdown-title">Title</Label>
            <Input
              id="countdown-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((p) => ({ ...p, title: false }));
              }}
              placeholder="What are you counting down to?"
              autoFocus
              className="rounded-lg"
            />
            {errors.title && (
              <p className="text-xs text-danger">Title is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Target date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "w-full justify-start rounded-lg font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "EEEE, d MMMM yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d);
                    if (errors.date) setErrors((p) => ({ ...p, date: false }));
                  }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
            {errors.date && (
              <p className="text-xs text-danger">Date is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Emoji</Label>
            <div className="flex flex-wrap gap-2">
              {EMOJI_PRESETS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-pressed={emoji === e}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg border text-xl",
                    emoji === e
                      ? "border-accent bg-accent/15"
                      : "border-border bg-surface-raised hover:border-muted-foreground/40"
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
