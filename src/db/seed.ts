// F5b Demo-Seed: curated order table + free slots ("stands in for your ERP").
// Idempotent — safe to run multiple times (upsert on primary key).
import { db } from "./index.js";
import { env } from "../config/env.js";

const orders = [
  {
    order_id: "ORD-1042",
    customer_name: "Sarah K.",
    item: "Oak dining table",
    phone: env.demoCalleeNumber,
    delivery_day: "Thursday",
    delivery_window: "8-12",
  },
  {
    order_id: "ORD-1043",
    customer_name: "Michael B.",
    item: "Walnut bookshelf",
    phone: "+491765550101",
    delivery_day: "Friday",
    delivery_window: "13-17",
  },
  {
    order_id: "ORD-1044",
    customer_name: "Anna P.",
    item: "Kitchen island",
    phone: "+491765550102",
    delivery_day: "Monday",
    delivery_window: "8-12",
  },
  {
    order_id: "ORD-1045",
    customer_name: "Tom H.",
    item: "Sofa, 3-seat",
    phone: "+491765550103",
    delivery_day: "Wednesday",
    delivery_window: "13-17",
  },
  {
    order_id: "ORD-1046",
    customer_name: "Julia R.",
    item: "Bed frame, queen",
    phone: "+491765550104",
    delivery_day: "Tuesday",
    delivery_window: "8-12",
  },
  {
    order_id: "ORD-1047",
    customer_name: "David K.",
    item: "Dining chairs, set of 4",
    phone: "+491765550105",
    delivery_day: "Thursday",
    delivery_window: "13-17",
  },
];

const freeSlots = [
  { id: "fs-1", day: "Monday", window: "8-12" },
  { id: "fs-2", day: "Monday", window: "13-17" },
  { id: "fs-3", day: "Tuesday", window: "8-12" },
];

const upsertOrder = db.prepare(`
  INSERT INTO orders (order_id, customer_name, item, phone, delivery_day, delivery_window)
  VALUES (@order_id, @customer_name, @item, @phone, @delivery_day, @delivery_window)
  ON CONFLICT(order_id) DO UPDATE SET
    customer_name = excluded.customer_name,
    item = excluded.item,
    phone = excluded.phone,
    delivery_day = excluded.delivery_day,
    delivery_window = excluded.delivery_window,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);

const upsertSlot = db.prepare(`
  INSERT INTO free_slots (id, day, window, taken)
  VALUES (@id, @day, @window, 0)
  ON CONFLICT(id) DO UPDATE SET day = excluded.day, window = excluded.window
`);

const seed = db.transaction(() => {
  for (const order of orders) upsertOrder.run(order);
  for (const slot of freeSlots) upsertSlot.run(slot);
});

seed();

console.log(`Seeded ${orders.length} orders and ${freeSlots.length} free slots.`);
