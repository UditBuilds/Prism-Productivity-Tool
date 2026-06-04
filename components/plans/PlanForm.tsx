"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { useCreatePlan, useUpdatePlan } from "@/hooks/usePlans";
import type { PlanStatus } from "@/types/database";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

/** Pin a picked calendar date to 12:00 IST so it lands on the right IST day. */
function pickedDateToIso(d: Date): string {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 6, 30, 0)
  ).toISOString();
}

export function PlanForm() {
  const { planDialogOpen, editingPlan, closePlanDialog } = useUIStore();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<PlanStatus>("active");
  const [targetDate, setTargetDate] = useState<Date | undefined>(undefined);
  const [titleError, setTitleError] = useState(false);

  // Hydrate the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!planDialogOpen) return;
    setTitleError(false);
    if (editingPlan) {
      setTitle(editingPlan.title);
      setDescription(editingPlan.description ?? "");
      setStatus(editingPlan.status);
      setTargetDate(
        editingPlan.target_date ? new Date(editingPlan.target_date) : undefined
      );
    } else {
      setTitle("");
      setDescription("");
      setStatus("active");
      setTargetDate(undefined);
    }
  }, [planDialogOpen, editingPlan]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }

    const payload = {
      title: trimmed,
      description: description.trim() || null,
      status,
      target_date: targetDate ? pickedDateToIso(targetDate) : null,
    };

    if (editingPlan) {
      updatePlan.mutate({ id: editingPlan.id, ...payload });
    } else {
      createPlan.mutate(payload);
    }
    closePlanDialog();
  }

  return (
    <Dialog
      open={planDialogOpen}
      onOpenChange={(open) => !open && closePlanDialog()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingPlan ? "Edit plan" : "New plan"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plan-title">Title</Label>
            <Input
              id="plan-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
              placeholder="What's the goal?"
              autoFocus
              className="rounded-lg"
            />
            {titleError && (
              <p className="text-xs text-danger">Title is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-description">Description</Label>
            <Textarea
              id="plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={3}
              className="rounded-lg"
            />
          </div>

          {editingPlan && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as PlanStatus)}
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Target date</Label>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start rounded-lg font-normal",
                      !targetDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {targetDate
                      ? format(targetDate, "EEEE, d MMMM yyyy")
                      : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={targetDate}
                    onSelect={setTargetDate}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              {targetDate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setTargetDate(undefined)}
                  aria-label="Clear target date"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={closePlanDialog}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
