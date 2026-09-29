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

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function formatWindow(w) {
  const [a, b] = w.split("-");
  return `${a}–${b}`;
}

function timeAgo(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = {
  active: "On record",
  broken: "Promise broken",
  confirmed: "Confirmed",
  superseded: "Superseded",
  needs_human: "Needs human",
};

function renderRegister(entries) {
  registerList.innerHTML = "";
  registerEmpty.hidden = entries.length > 0;

  statTotal.textContent = entries.length;
  statBroken.textContent = entries.filter((e) => e.status === "broken").length;
  statConfirmed.textContent = entries.filter((e) => e.status === "confirmed").length;

  for (const entry of entries) {
    const div = document.createElement("div");
    const justBroke = entry.status === "broken" && prevStatusById[entry.id] && prevStatusById[entry.id] !== "broken";
    div.className = `entry status-${entry.status}${justBroke ? " just-broken" : ""}`;
    prevStatusById[entry.id] = entry.status;

    const btn = document.createElement("button");
    btn.className = "play-btn";
    btn.textContent = "▶";
    btn.disabled = entry.anchor_status !== "ok";
    btn.onclick = () => togglePlay(entry, btn);

    const body = document.createElement("div");
    body.className = "entry-body";

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
    meta.innerHTML = `<span class="pill ${pillClass}">${statusText}</span><span>${timeAgo(entry.created_at)}</span>`;

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
    tr.innerHTML = `
      <td class="py-2 pr-2 font-medium text-slate-500">${order.order_id}</td>
      <td class="py-2 pr-2">${order.customer_name}</td>
      <td class="py-2 pr-2 text-slate-500">${order.item}</td>
      <td class="py-2 pr-2" contenteditable="true" data-field="delivery_day" data-order="${order.order_id}">${order.delivery_day}</td>
      <td class="py-2" contenteditable="true" data-field="delivery_window" data-order="${order.order_id}">${order.delivery_window}</td>
    `;
    ordersBody.appendChild(tr);
  }

  ordersBody.querySelectorAll("td[contenteditable]").forEach((td) => {
    td.addEventListener("blur", onEditableBlur);
    td.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        td.blur();
      }
    });
  });
}

let lastValues = {};
async function onEditableBlur(e) {
  const td = e.target;
  const orderId = td.dataset.order;
  const field = td.dataset.field;
  const value = td.textContent.trim();
  const key = `${orderId}:${field}`;
  if (lastValues[key] === value) return;
  lastValues[key] = value;

  try {
    await fetchJson(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    td.classList.remove("saved");
    void td.offsetWidth;
    td.classList.add("saved");
  } catch (err) {
    console.error("Failed to save order edit", err);
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
  renderOrders(orders);
  renderRegister(register);
  renderFreeSlots(slots);
}

function showCallStatus(text, live) {
  statCall.textContent = text;
  railPulse.classList.toggle("live", !!live);
  clearTimeout(callStatusTimer);
  if (live) {
    callStatusTimer = setTimeout(() => {
      statCall.textContent = "No active call";
      railPulse.classList.remove("live");
    }, 20000);
  }
}

function connectStream() {
  const es = new EventSource("/api/stream");
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
    es.close();
    setTimeout(connectStream, 2000);
  };
}

refreshAll().catch(console.error);
connectStream();
setInterval(() => {
  // keep "broken since Xs" ticking; skip while a clip is playing so the
  // re-render doesn't yank the play button out from under the click.
  if (currentPlay) return;
  refreshAll().catch(() => {});
}, 5000);
