import { create } from "zustand";

import type { Note, Plan, Reminder, Task } from "@/types/database";

interface UIState {
  /** Task create/edit dialog. `editingTask === null` means "create". */
  taskDialogOpen: boolean;
  editingTask: Task | null;
  openCreateTask: () => void;
  openEditTask: (task: Task) => void;
  closeTaskDialog: () => void;

  /** Note create/edit dialog. `editingNote === null` means "create". */
  noteDialogOpen: boolean;
  editingNote: Note | null;
  openCreateNote: () => void;
  openEditNote: (note: Note) => void;
  closeNoteDialog: () => void;

  /** Plan create/edit dialog. `editingPlan === null` means "create". */
  planDialogOpen: boolean;
  editingPlan: Plan | null;
  openCreatePlan: () => void;
  openEditPlan: (plan: Plan) => void;
  closePlanDialog: () => void;

  /** Reminder create/edit dialog. `editingReminder === null` means "create". */
  reminderDialogOpen: boolean;
  editingReminder: Reminder | null;
  openCreateReminder: () => void;
  openEditReminder: (reminder: Reminder) => void;
  closeReminderDialog: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  taskDialogOpen: false,
  editingTask: null,
  openCreateTask: () => set({ taskDialogOpen: true, editingTask: null }),
  openEditTask: (task) => set({ taskDialogOpen: true, editingTask: task }),
  closeTaskDialog: () => set({ taskDialogOpen: false, editingTask: null }),

  noteDialogOpen: false,
  editingNote: null,
  openCreateNote: () => set({ noteDialogOpen: true, editingNote: null }),
  openEditNote: (note) => set({ noteDialogOpen: true, editingNote: note }),
  closeNoteDialog: () => set({ noteDialogOpen: false, editingNote: null }),

  planDialogOpen: false,
  editingPlan: null,
  openCreatePlan: () => set({ planDialogOpen: true, editingPlan: null }),
  openEditPlan: (plan) => set({ planDialogOpen: true, editingPlan: plan }),
  closePlanDialog: () => set({ planDialogOpen: false, editingPlan: null }),

  reminderDialogOpen: false,
  editingReminder: null,
  openCreateReminder: () =>
    set({ reminderDialogOpen: true, editingReminder: null }),
  openEditReminder: (reminder) =>
    set({ reminderDialogOpen: true, editingReminder: reminder }),
  closeReminderDialog: () =>
    set({ reminderDialogOpen: false, editingReminder: null }),
}));
