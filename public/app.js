const registerList = document.getElementById("register-list");
const registerEmpty = document.getElementById("register-empty");
const ordersBody = document.getElementById("orders-body");
const freeSlotsList = document.getElementById("free-slots-list");
const statTotal = document.getElementById("stat-total");
const statBroken = document.getElementById("stat-broken");
const statConfirmed = document.getElementById("stat-confirmed");
const statCall = document.getElementById("stat-call");
const railPulse = document.getElementById("rail-pulse");
const player = document.getElementById("clip-player");

let currentPlay = null; // { entryId, btn, startMs, endMs, words, raf }
let callStatusTimer = null;
let prevStatusById = {}; // entry.id -> last-seen status, to detect the broken transition
let editingCount = 0; // >0 while a select is focused or a cell is being edited — pauses the fallback poll
let sseConnected = false;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function formatWindow(w) {
  const [a, b] = w.split("-");
  return `${a}–${b}`;
}

// Mirrors the server's formatPromiseTime (src/agents/callback.ts) so the
// card and the agent's own spoken greeting always agree: "Last night ·
// 1:41 AM" or "Wed · 7:42 PM", always Europe/Berlin, never hardcoded.
const BERLIN_TZ = "Europe/Berlin";

function berlinParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { dateStr: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function calendarDayDiff(fromDateStr, toDateStr) {
  const from = Date.parse(`${fromDateStr}T00:00:00Z`);
  const to = Date.parse(`${toDateStr}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function formatCardTime(iso, now = new Date()) {
  const d = new Date(iso);
  const entry = berlinParts(d);
  const current = berlinParts(now);
  const diff = calendarDayDiff(entry.dateStr, current.dateStr);
  const isLastNight = (diff === 0 && entry.hour < 5) || (diff === 1 && entry.hour >= 18);

  const time = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  if (isLastNight) return `Last night · ${time}`;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN_TZ, weekday: "short" }).format(d);
  return `${weekday} · ${time}`;
}

const STATUS_LABEL = {
  active: "On record",
  broken: "Promise broken",
  confirmed: "Confirmed",
  superseded: "Superseded",
  needs_human: "Needs human",
};

// A single call moment often produces two internal rows (delivery_day +
// delivery_window) anchored to the exact same words. Shown separately they
// read as two promises; merge them into one card — "Thursday · 8–12 · ▶" —
// as long as they still share a status. The moment one of them breaks
// (e.g. only delivery_day), they naturally fall apart into separate cards.
const FIELD_ORDER = ["delivery_day", "delivery_window", "price", "callback"];

function formatFieldValue(field, value) {
  if (field === "delivery_window") {
    const nums = value.match(/\d{1,2}/g);
    if (nums && nums.length >= 2) return `${nums[0]}–${nums[1]}`;
  }
  return value;
}

function groupRegisterEntries(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.start_ms != null && e.end_ms != null ? `${e.call_id}|${e.start_ms}|${e.end_ms}` : `solo:${e.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const items = [];
  for (const [key, members] of groups) {
    if (members.length > 1 && members.every((m) => m.status === members[0].status)) {
      const sorted = [...members].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
      const deliverySummary = sorted.map((m) => formatFieldValue(m.field, m.value)).join(" ");
      items.push({ ...sorted[0], _deliverySummary: deliverySummary, _key: key });
    } else {
      for (const m of members) items.push({ ...m, _deliverySummary: formatFieldValue(m.field, m.value), _key: m.id });
    }
  }
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items;
}

function renderRegister(rawEntries) {
  const entries = groupRegisterEntries(rawEntries);
  registerList.innerHTML = "";
  registerEmpty.hidden = entries.length > 0;

  statTotal.textContent = entries.length;
  statBroken.textContent = entries.filter((e) => e.status === "broken").length;
  statConfirmed.textContent = entries.filter((e) => e.status === "confirmed").length;

  for (const entry of entries) {
    const div = document.createElement("div");
    const justBroke = entry.status === "broken" && prevStatusById[entry._key] && prevStatusById[entry._key] !== "broken";
    div.className = `entry status-${entry.status}${justBroke ? " just-broken" : ""}`;
    prevStatusById[entry._key] = entry.status;

    const btn = document.createElement("button");
    btn.className = "play-btn";
    btn.textContent = "▶";
    btn.disabled = entry.anchor_status !== "ok";
    btn.onclick = () => togglePlay(entry, btn);

    const body = document.createElement("div");
    body.className = "entry-body";

    const header = document.createElement("div");
    header.className = "entry-header";
    const who = entry.customer_name ? `${entry.customer_name} · ` : "";
    const order = entry.order_id ? `${entry.order_id} · ` : "";
    header.textContent = `${who}${order}Delivery: ${entry._deliverySummary}`;

    const meta = document.createElement("div");
    meta.className = "entry-meta";
    let statusText = STATUS_LABEL[entry.status] || entry.status;
    let pillClass = `pill-${entry.status}`;
    if (entry.status === "broken") {
      const secs = entry.broken_seconds ?? 0;
      statusText += ` · ${secs}s`;
      if (entry.callback_call_status === "in_progress") statusText = "Calling…";
      if (entry.callback_call_status === "no_answer") statusText = "Call unanswered · retry in 10 min";
    }
    const cardTime = formatCardTime(entry.call_started_at || entry.created_at);
    meta.innerHTML = `<span class="pill ${pillClass}">${statusText}</span><span>${cardTime}</span>`;

    const quote = document.createElement("div");
    quote.className = "entry-quote";
    quote.dataset.entryId = entry.id;
    quote.textContent = entry.quote;
    if (entry.anchor_status !== "ok") {
      const missing = document.createElement("div");
      missing.className = "anchor-missing";
      missing.textContent = "audio anchor missing";
      quote.appendChild(missing);
    }

    const progress = document.createElement("div");
    progress.className = "entry-progress";
    const bar = document.createElement("div");
    bar.className = "entry-progress-bar";
    progress.appendChild(bar);

    body.appendChild(header);
    body.appendChild(meta);
    body.appendChild(quote);
    body.appendChild(progress);
    div.appendChild(btn);
    div.appendChild(body);
    registerList.appendChild(div);
  }
}

async function togglePlay(entry, btn) {
  if (currentPlay && currentPlay.entryId === entry.id) {
    stopPlay();
    return;
  }
  stopPlay();

  let words = [];
  try {
    const all = await fetchJson(`/api/calls/${entry.call_id}/words`);
    words = all.filter((w) => w.end_ms >= entry.start_ms && w.start_ms <= entry.end_ms);
  } catch {
    // word highlighting is best-effort; playback still works without it
  }

  const quoteEl = document.querySelector(`.entry-quote[data-entry-id="${entry.id}"]`);
  if (quoteEl && words.length) {
    quoteEl.innerHTML = words.map((w) => `<span class="word" data-start="${w.start_ms}" data-end="${w.end_ms}">${w.text}</span>`).join(" ");
  }

  const bar = btn.parentElement.querySelector(".entry-progress-bar");

  player.src = `/media/recordings/${entry.call_id}`;
  player.currentTime = entry.start_ms / 1000;
  btn.classList.add("playing");
  btn.textContent = "■";

  currentPlay = { entryId: entry.id, btn, startMs: entry.start_ms, endMs: entry.end_ms, quoteEl, bar };

  const onLoaded = () => {
    player.currentTime = entry.start_ms / 1000;
    player.play().catch(() => {});
  };
  player.addEventListener("loadedmetadata", onLoaded, { once: true });

  const tick = () => {
    if (!currentPlay) return;
    const ms = player.currentTime * 1000;
    if (ms >= currentPlay.endMs) {
      stopPlay();
      return;
    }
    const pct = Math.max(0, Math.min(100, ((ms - currentPlay.startMs) / (currentPlay.endMs - currentPlay.startMs)) * 100));
    currentPlay.bar.style.width = `${pct}%`;
    if (currentPlay.quoteEl) {
      currentPlay.quoteEl.querySelectorAll(".word").forEach((w) => {
        const active = ms >= Number(w.dataset.start) && ms <= Number(w.dataset.end);
        w.classList.toggle("active", active);
      });
    }
    currentPlay.raf = requestAnimationFrame(tick);
  };
  currentPlay.raf = requestAnimationFrame(tick);
}

function stopPlay() {
  if (!currentPlay) return;
  cancelAnimationFrame(currentPlay.raf);
  currentPlay.btn.classList.remove("playing");
  currentPlay.btn.textContent = "▶";
  currentPlay.bar.style.width = "0%";
  if (currentPlay.quoteEl) currentPlay.quoteEl.querySelectorAll(".word").forEach((w) => w.classList.remove("active"));
  player.pause();
  currentPlay = null;
}

function renderOrders(orders) {
  ordersBody.innerHTML = "";
  for (const order of orders) {
    const tr = document.createElement("tr");
    const dayOptions = WEEKDAYS.map(
      (d) => `<option value="${d}" ${d === order.delivery_day ? "selected" : ""}>${d}</option>`
    ).join("");
    tr.innerHTML = `
      <td class="py-2 pr-2 font-medium text-slate-500">${order.order_id}</td>
      <td class="py-2 pr-2">${order.customer_name}</td>
      <td class="py-2 pr-2 text-slate-500">${order.item}</td>
      <td class="py-2 pr-2 order-cell" data-field="delivery_day" data-order="${order.order_id}">
        <select class="day-select">${dayOptions}</select>
        <span class="saved-badge" hidden>Saved</span>
      </td>
      <td class="py-2 order-cell" contenteditable="true" data-field="delivery_window" data-order="${order.order_id}">${order.delivery_window}</td>
    `;
    ordersBody.appendChild(tr);
  }

  // Dropdown: a clean click-select, PATCH fires immediately on change — no
  // typing, no blur race with the table refresh.
  ordersBody.querySelectorAll(".day-select").forEach((select) => {
    select.addEventListener("focus", () => editingCount++);
    select.addEventListener("blur", () => editingCount--);
    select.addEventListener("change", (e) => {
      const cell = e.target.closest(".order-cell");
      saveOrderField(cell.dataset.order, "delivery_day", e.target.value, cell);
    });
  });

  ordersBody.querySelectorAll("td[contenteditable]").forEach((td) => {
    td.addEventListener("focus", () => editingCount++);
    td.addEventListener("blur", () => {
      editingCount--;
      saveOrderField(td.dataset.order, td.dataset.field, td.textContent.trim(), td);
    });
    td.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        td.blur();
      }
    });
  });
}

let lastValues = {};
async function saveOrderField(orderId, field, value, cellEl) {
  const key = `${orderId}:${field}`;
  if (lastValues[key] === value) return;
  lastValues[key] = value;

  try {
    await fetchJson(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    flashSaved(cellEl);
  } catch (err) {
    console.error("Failed to save order edit", err);
  }
}

function flashSaved(cellEl) {
  cellEl.classList.remove("saved");
  void cellEl.offsetWidth;
  cellEl.classList.add("saved");
  const badge = cellEl.querySelector(".saved-badge");
  if (badge) {
    badge.hidden = false;
    clearTimeout(badge._hideTimer);
    badge._hideTimer = setTimeout(() => {
      badge.hidden = true;
    }, 1200);
  }
}

function renderFreeSlots(slots) {
  freeSlotsList.innerHTML = "";
  for (const slot of slots) {
    const li = document.createElement("li");
    if (slot.taken) li.classList.add("taken");
    li.textContent = `${slot.day} ${formatWindow(slot.window)}`;
    freeSlotsList.appendChild(li);
  }
}

async function refreshAll() {
  const [orders, register, slots] = await Promise.all([
    fetchJson("/api/orders"),
    fetchJson("/api/register"),
    fetchJson("/api/free-slots"),
  ]);
  // Never rebuild the orders table while a cell is focused/being edited —
  // that's what silently dropped an edit before (the table refresh raced
  // the in-progress edit and won).
  if (editingCount === 0) renderOrders(orders);
  renderRegister(register);
  renderFreeSlots(slots);
}

function showCallStatus(text, live) {
  statCall.textContent = text;
  clearTimeout(callStatusTimer);
  if (live) {
    callStatusTimer = setTimeout(() => {
      statCall.textContent = "No active call";
    }, 20000);
  }
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onopen = () => {
    sseConnected = true;
    railPulse.classList.add("live"); // "Live updates" — reflects SSE connectivity, not call activity
  };
  es.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    if (event.type === "register_updated") {
      refreshAll().catch(console.error);
    } else if (event.type === "call_status") {
      const labels = {
        dialing: "Calling…",
        in_progress: "On call",
        agent_speaking: "Calling…",
        completed: "Call ended",
        no_answer: "Call unanswered",
        failed: "Call failed",
      };
      if (event.purpose === "callback" && labels[event.status]) {
        const live = !["completed", "no_answer", "failed"].includes(event.status);
        showCallStatus(labels[event.status], live);
      }
    }
  };
  es.onerror = () => {
    sseConnected = false;
    railPulse.classList.remove("live");
    es.close();
    setTimeout(connectStream, 2000);
  };
}

refreshAll().catch(console.error);
connectStream();
// SSE is the source of truth while connected — this is a fallback only,
// so a dropped connection doesn't leave the page stale. Never fires while
// SSE is up, so it can't race an in-progress edit or a playing clip.
setInterval(() => {
  if (sseConnected) return;
  if (editingCount > 0 || currentPlay) return;
  refreshAll().catch(() => {});
}, 5000);
