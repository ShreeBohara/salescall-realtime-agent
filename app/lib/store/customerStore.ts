/**
 * Tiny module-level store for the currently-selected customer.
 *
 * Mirrors the pattern in `./taskStore.ts` and `./noteStore.ts` so the UI
 * can subscribe via `useSyncExternalStore`. The store holds just the ID;
 * consumers resolve the full Customer object via `getCustomerById`.
 *
 * Defaults to the first seed customer so the app never starts in a
 * "no context" state (the demo narrative assumes you're always on some
 * call). The rep can switch before connecting; locked while connected.
 */

import { CUSTOMERS, type Customer, getCustomerById } from "../data/customers";

type Listener = () => void;

let selectedCustomerId: string = CUSTOMERS[0]?.id ?? "";
const listeners = new Set<Listener>();

export function getSelectedCustomerId(): string {
  return selectedCustomerId;
}

export function getSelectedCustomer(): Customer | null {
  return getCustomerById(selectedCustomerId);
}

export function setSelectedCustomerId(id: string) {
  if (id === selectedCustomerId) return;
  selectedCustomerId = id;
  listeners.forEach((l) => l());
}

export function subscribeToSelectedCustomer(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
