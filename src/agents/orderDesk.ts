import { findOrder } from "../db/orders.js";
import { setCallOrder } from "../db/calls.js";
import type { ToolDef } from "../telephony/voiceAgentClient.js";

// F2 Erstanruf-Agent "Order desk". Recording announcement is the first thing
// said (dealbreaker: consent before anything else). Keeps the day + window
// verbatim so the deterministic word-aligner (F4) can anchor it later.
export const ORDER_DESK_GREETING =
  "Thank you for calling Northwind Furniture. This call is recorded so we can keep our promises. Can I get your order number or name?";

export const ORDER_DESK_SYSTEM_PROMPT = `You are the order desk voice agent for Northwind Furniture, a furniture and kitchen retailer. You are speaking with a customer in real time over the phone.

Your only job on this call: look up their order with the lookup_order tool (they will give you an order id like "ORD-1042" or their name), then tell them their delivery day and time window clearly and exactly as stored, for example: "Your delivery is scheduled for Thursday, between 8 and 12."

Keep responses short and conversational, one or two sentences, since they are spoken aloud. Do not invent a delivery day or window — always use the lookup_order tool first. If the order can't be found, ask them to repeat the order number or name, or apologize and say a team member will follow up.

Be direct and warm, never apologetic or salesy. Do not use words like "unfortunately" or "revolutionary".`;

export const ORDER_DESK_TOOLS: ToolDef[] = [
  {
    type: "function",
    name: "lookup_order",
    description: "Look up a customer's order by order id (e.g. ORD-1042) or customer name to find their delivery day and time window.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Order id or customer name as given by the caller." },
      },
      required: ["query"],
    },
  },
];

export function runOrderDeskTool(callId: string, name: string, args: Record<string, unknown>): string {
  if (name !== "lookup_order") {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
  const query = String(args.query ?? "");
  const order = findOrder(query);
  if (!order) {
    return JSON.stringify({ found: false });
  }
  setCallOrder(callId, order.order_id);
  return JSON.stringify({
    found: true,
    order_id: order.order_id,
    customer_name: order.customer_name,
    item: order.item,
    delivery_day: order.delivery_day,
    delivery_window: order.delivery_window,
  });
}
