import { create } from "zustand";

import type { Task } from "@/types/database";

interface UIState {
  /** Task create/edit dialog. `editingTask === null` means "create". */
  taskDialogOpen: boolean;
  editingTask: Task | null;
  openCreateTask: () => void;
  openEditTask: (task: Task) => void;
  closeTaskDialog: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  taskDialogOpen: false,
  editingTask: null,
  openCreateTask: () => set({ taskDialogOpen: true, editingTask: null }),
  openEditTask: (task) => set({ taskDialogOpen: true, editingTask: task }),
  closeTaskDialog: () => set({ taskDialogOpen: false, editingTask: null }),
}));
