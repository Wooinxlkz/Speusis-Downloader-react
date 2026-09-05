import { create } from "zustand";

interface CategoryState {
  category: string;
  set: (category: string) => void;
}

export const useCategoryStore = create<CategoryState>((set) => ({
  category: "all",
  set: (category) => set({ category }),
}));
