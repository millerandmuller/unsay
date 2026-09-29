import { db, type OrderRow, type FreeSlotRow } from "./index.js";

export function listOrders(): OrderRow[] {
  return db.prepare(`SELECT * FROM orders ORDER BY order_id`).all() as OrderRow[];
}

export function getOrder(orderId: string): OrderRow | undefined {
  return db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId) as OrderRow | undefined;
}

export function findOrder(query: string): OrderRow | undefined {
  const byId = getOrder(query.trim().toUpperCase());
  if (byId) return byId;
  const needle = `%${query.trim().toLowerCase()}%`;
  return db
    .prepare(`SELECT * FROM orders WHERE lower(customer_name) LIKE ? ORDER BY order_id LIMIT 1`)
    .get(needle) as OrderRow | undefined;
}

export function updateOrderField(orderId: string, field: "delivery_day" | "delivery_window", value: string): OrderRow {
  db.prepare(
    `UPDATE orders SET ${field} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE order_id = ?`
  ).run(value, orderId);
  return getOrder(orderId)!;
}

export function listFreeSlots(): FreeSlotRow[] {
  return db.prepare(`SELECT * FROM free_slots ORDER BY id`).all() as FreeSlotRow[];
}

export function isSlotFree(slotId: string): boolean {
  const slot = db.prepare(`SELECT * FROM free_slots WHERE id = ?`).get(slotId) as FreeSlotRow | undefined;
  return !!slot && slot.taken === 0;
}

export function takeSlot(slotId: string): void {
  db.prepare(`UPDATE free_slots SET taken = 1 WHERE id = ?`).run(slotId);
}
