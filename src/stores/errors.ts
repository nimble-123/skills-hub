/**
 * Transient messages.
 *
 * Every command can fail, and a failure the user never sees is worse than one
 * they do. Anything that goes wrong lands here.
 */

import { create } from "zustand";
import type { CommandError } from "../bindings";

export type Toast = {
  id: number;
  kind: "error" | "info";
  message: string;
  /** The error code, for the rare case where the UI wants to react to one. */
  code?: string;
};

type ToastStore = {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => set((current) => ({ toasts: [...current.toasts, { ...toast, id: nextId++ }] })),
  dismiss: (id) => set((current) => ({ toasts: current.toasts.filter((t) => t.id !== id) })),
}));

export function reportError(error: CommandError): void {
  useToasts.getState().push({ kind: "error", message: error.message, code: error.code });
}

export function reportInfo(message: string): void {
  useToasts.getState().push({ kind: "info", message });
}
