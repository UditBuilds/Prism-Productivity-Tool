"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { isBackdated, workoutDateLabel, workoutToday } from "@/lib/workouts";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * "When was this?" for the two logging surfaces on /dashboard/workout.
 *
 * Sets get logged on the day they happen right up until they don't — a session
 * on Saturday remembered on Monday had nowhere to go, because all three
 * capture paths stamped the current instant. This is the only mechanism for
 * going back: no toggle, no mode switch, and the default is always today, so
 * the common case costs nothing.
 *
 * Not a new picker. It is the Calendar + Popover pair ReminderForm and TaskForm
 * already use, with the same `variant="outline"` trigger and the same
 * "value is a Date whose LOCAL civil fields carry the intended day" contract.
 *
 * NO FUTURE DATES. `disabled={{ after: today }}` — a set you have not done yet
 * is not a log, and the analysis compares a top set against the PREVIOUS
 * session, so a row dated ahead of today would sit permanently at the end of
 * every comparison and make the most recent real session read as the previous
 * one. Today itself stays selectable; there is no lower bound, because
 * backdating past the 180-day analysis window is accepted behaviour (the set
 * is still stored and still correct, it is just older than the window can see).
 *
 * `workoutToday()` is called per render rather than captured once, so a sheet
 * left open across IST midnight offers the new today.
 *
 * CONTROLLED OPEN, so picking a day closes the popover. ReminderForm and
 * TaskForm leave theirs open — a calendar sitting over the form until you click
 * away. Copied verbatim that would put a calendar over the Save button you were
 * on your way to press. One day is all this picker takes; nothing is left to
 * choose after the first tap.
 */
export function WorkoutDatePicker({
  value,
  onChange,
  className,
  triggerClassName,
}: {
  value: Date;
  onChange: (date: Date) => void;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = workoutToday();
  const backdated = isBackdated(value);

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            // The label carries the state, so a backdated capture cannot look
            // like a today capture: "Today" is muted, a real date is accent.
            className={cn(
              "h-9 w-full justify-start rounded-md font-normal",
              backdated ? "text-accent" : "text-muted-foreground",
              triggerClassName
            )}
            aria-label={`Date logged: ${workoutDateLabel(value)}`}
          >
            <CalendarIcon aria-hidden className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">{workoutDateLabel(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            // Radix hands back `undefined` when the selected day is tapped
            // again. There is no "no date" state here — every set happened on
            // some day — so a deselect keeps the current value.
            onSelect={(d) => {
              if (!d) return;
              onChange(d);
              setOpen(false);
            }}
            disabled={{ after: today }}
            defaultMonth={value}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
