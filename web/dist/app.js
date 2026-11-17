import { makeEstimator, scoreCsv, priority, columns, csvText } from "./model.mjs";

const $ = id => document.getElementById(id);
const statuses = ["New", "Investigating", "Action taken", "Resolved"];
const actions = {
  "Act now": "Confirm the revised ETA and ask about recovery options.",
  "Watch": "Verify the next shipping milestone and set a follow-up.",
  "Monitor": "Review the next routine tracking update."
};
let queue = [], selected, batchText;
let infoPromise, forestPromise;
function info() {
  return infoPromise ??= fetch("model-info.json")
    .then(response => { if (!response.ok) throw Error("Could not load model information."); return response.json(); })
    .catch(error => { infoPromise = undefined; throw error; });
}
function forest() {
  return forestPromise ??= fetch("forest.json.gz").then(async response => {
    if (!response.ok || !response.body) throw Error("Could not load the trained model.");
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  }).catch(error => { forestPromise = undefined; throw error; });
}
async function estimator() {
  const [meta, trees] = await Promise.all([info(), forest()]);
  return makeEstimator(meta, trees);
}
const STORE = "relay-queue-v1";
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({queue, batchText, label: $("batch-label").textContent})); }
  catch { /* storage unavailable or full: the queue still works for this visit */ }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!saved?.queue?.length) return;
    ({queue, batchText} = saved);
    $("batch-label").textContent = saved.label.replace(/ \(restored\)$/,"") + " (restored)";
    $("workspace").hidden = false;
    $("empty-queue").hidden = true;
    renderQueue();
  } catch { try { localStorage.removeItem(STORE); } catch { /* ignore */ } }
}

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function feedback(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
}
function timing(days) {
  const rounded = Math.abs(days).toFixed(2);
  if (days === 0) return "On time";
  return (rounded === "0.00" ? "<0.01" : rounded) + " d " + (days > 0 ? "late" : "early");
}
function spread(low, high) {
  const part = value => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toFixed(1);
  return "Likely range " + part(low) + " to " + part(high) + " days (+ is late)";
}
function totals(id, items) {
  $(id).replaceChildren(...items.map(([label, value]) => {
    const span = node("span");
    span.append(node("strong",value),label);
    return span;
  }));
}
function renderQueue() {
  const open = queue.filter(row => row.status !== "Resolved");
  const visible = $("resolved").checked ? queue : open;
  if (!visible.some(row => row.id === selected)) selected = visible[0]?.id;
  totals("totals",[["need attention now",open.filter(row => row.priority === "Act now").length],["open",open.length],["resolved",queue.length-open.length]]);
  $("rows").replaceChildren();
  for (const shipment of visible) {
    const {id,origin,destination,days,priority:rank,status} = shipment;
    const tr = node("tr",undefined,id === selected ? "active" : "");
    const first = node("td");
    const button = node("button",id,"pick");
    button.setAttribute("aria-pressed",String(id === selected));
    button.onclick = () => { selected = id; feedback("save-status",""); renderQueue(); $("review-title").focus(); };
    first.append(button,node("small",origin + " → " + destination),node("small",status,"mobile-status"));
    const priorityCell = node("td");
    priorityCell.append(node("span",rank,"tag " + (rank === "Act now" ? "urgent" : rank === "Watch" ? "watch" : "")));
    tr.append(first,node("td",timing(days)),priorityCell,node("td",status,"shipment-status"));
    $("rows").append(tr);
  }
  if (!visible.length) {
    const tr = node("tr"), td = node("td","All shipments in this batch are resolved.");
    td.colSpan = 4;
    tr.append(td);
    $("rows").append(tr);
  }
  renderDetail(visible.find(row => row.id === selected));
}
function renderDetail(shipment) {
  const detail = $("detail");
  detail.replaceChildren();
  if (!shipment) {
    detail.append(node("p","Include resolved shipments to review their decisions.","muted"));
    return;
  }
  const fragment = $("review-template").content.cloneNode(true);
  const title = fragment.querySelector("h3");
  title.id = "review-title";
  title.tabIndex = -1;
  title.textContent = shipment.id;
  fragment.querySelector(".route").textContent = shipment.origin + " → " + shipment.destination + " / " + shipment.mode;
  fragment.querySelector(".estimate").textContent = timing(shipment.days) + " · " + shipment.priority
    + (shipment.fallback ? " · shipping-mode average (route not in training data)" : "");
  fragment.querySelector(".range").textContent = spread(shipment.low, shipment.high);
  fragment.querySelector(".action").textContent = actions[shipment.priority];
  const form = fragment.querySelector("form");
  const status = form.elements.namedItem("status"), note = form.elements.namedItem("note");
  for (const item of statuses) status.add(new Option(item,item));
  status.value = shipment.status;
  note.value = shipment.note;
  form.onsubmit = event => {
    event.preventDefault();
    shipment.status = status.value;
    shipment.note = note.value.trim();
    save();
    renderQueue();
    feedback("save-status","Decision saved for " + shipment.id + ".");
    ($("review-title") || $("resolved")).focus();
  };
  detail.append(fragment);
}
async function loadBatch(read, label) {
  for (const id of ["score","sample"]) $(id).disabled = true;
  feedback("load-status","Scoring shipments…");
  $("load-problems").replaceChildren();
  try {
    const [source, estimate] = await Promise.all([read(), estimator()]);
    if (batchText !== source) {
      queue = scoreCsv(source,estimate);
      selected = undefined;
      $("resolved").checked = false;
      batchText = source;
    }
    $("batch-label").textContent = label;
    $("workspace").hidden = false;
    $("empty-queue").hidden = true;
    feedback("save-status","");
    renderQueue();
    save();
    const generic = queue.filter(row => row.fallback).length;
    feedback("load-status",queue.length + " shipments scored." + (generic ? " " + generic + " use the shipping-mode average because their route was not in the training data." : ""));
  } catch (error) {
    $("load-problems").replaceChildren(...(error.problems ?? []).map(text => node("li",text)));
    feedback("load-status",error.message + (queue.length ? " The current queue is still available." : ""),true);
  } finally {
    for (const id of ["score","sample"]) $(id).disabled = false;
  }
}
$("upload-form").onsubmit = event => {
  event.preventDefault();
  const file = $("file").files[0];
  if (file) loadBatch(() => file.text(),"Uploaded batch / " + file.name);
};
$("sample").onclick = () => loadBatch(async () => {
  const response = await fetch("sample-shipments.csv");
  if (!response.ok) throw Error("Could not load sample shipments.");
  return response.text();
},"Sample batch");
$("resolved").onchange = renderQueue;
$("clear").onclick = () => {
  if (!confirm("Remove the saved queue and all decisions from this browser? Export first if you want a copy.")) return;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  queue = []; selected = batchText = undefined;
  $("workspace").hidden = true;
  $("empty-queue").hidden = false;
  feedback("load-status","Saved queue removed.");
};
$("export").onclick = () => {
  const csv = csvText([[...columns,"predicted_delay_days","likely_low_days","likely_high_days","estimate_basis","priority","status","decision_note"],...queue.map(s => [s.id,s.origin,s.destination,s.mode,s.days,s.low,s.high,s.fallback ? "mode average" : "route model",s.priority,s.status,s.note])]);
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link = node("a");
  link.href = url;
  link.download = "triage-results.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
};
function historyTable(title, headings, rows, open = false) {
  const section = node("details",undefined,"chart");
  section.open = open;
  const wrap = node("div",undefined,"scroll"), table = node("table");
  const head = node("thead"), header = node("tr"), body = node("tbody");
  header.append(...headings.map(value => node("th",value)));
  head.append(header);
  for (const values of rows) {
    const row = node("tr");
    row.append(...values.map(value => node("td",value)));
    body.append(row);
  }
  table.append(head,body);
  wrap.append(table);
  section.append(node("summary",title),wrap);
  return section;
}
async function showHistory() {
  if ($("charts").childElementCount) return;
  feedback("history-status","Loading historical summary…");
  try {
    const meta = await info();
    const share = value => (value * 100).toFixed(1) + "%";
    const pct = value => value == null ? "n/a" : Math.round(value * 100) + "%";
    totals("history-totals",[["historical order lines",meta.orders.toLocaleString()],["average delay",meta.mean.toFixed(2) + " d"],["average error on unseen orders",meta.mae.toFixed(2) + " d"],["error of a shipping-mode-only guess",meta.baseline_mae.toFixed(2) + " d"],["“Act now” precision",pct(meta.act_precision)],["“Act now” recall",pct(meta.act_recall)],["shipments flagged “Act now”",share(meta.act_flagged_share)],["shipments truly over 2 days late",share(meta.act_base_rate)]]);
    $("history-note").textContent = "Measured on " + meta.test_orders.toLocaleString() + " held-out orders the model never saw. Route history adds little over the shipping mode alone for average error, so treat the ranking as a prompt to check, not a promise.";
    const days = value => { const text = value.toFixed(2); return text === "-0.00" ? "0.00" : text; };
    const averages = values => values.map(([label,value,count]) => [label,days(value),count.toLocaleString()]);
    $("charts").replaceChildren(
      historyTable("Average delay by shipping mode",["Shipping mode","Average delay (days)","Order lines"],averages(meta.modes),true),
      historyTable("Destinations with the highest average delays (at least 50 order lines)",["Destination","Average delay (days)","Order lines"],averages(meta.destinations),true),
      historyTable("Historical delay distribution",["Days late","Orders"],meta.histogram.map(([days,count]) => [days,count.toLocaleString()]))
    );
    feedback("history-status","");
  } catch (error) { feedback("history-status",error.message,true); }
}
async function prepareForecast() {
  if ($("mode").options.length) return;
  $("predict").disabled = true;
  try {
    const meta = await info();
    for (const [index,id] of ["origins","destinations","mode"].entries()) {
      $(id).replaceChildren(...meta.classes[index].map(value => new Option(value,value)));
    }
    $("predict").disabled = false;
    feedback("forecast-status","");
  } catch (error) { feedback("forecast-status",error.message,true); }
}
$("forecast-form").onsubmit = async event => {
  event.preventDefault();
  $("predict").disabled = true;
  feedback("forecast-status","Predicting delay…");
  try {
    const estimate = await estimator();
    const {days,fallback,low,high} = estimate(["origin","destination","mode"].map(id => $(id).value.trim()));
    feedback("forecast-status",timing(days) + " · " + priority(days) + (fallback ? " · shipping-mode average (route not in training data)" : "") + " · " + spread(low,high));
  } catch (error) { feedback("forecast-status",error.message,true); }
  finally { $("predict").disabled = false; }
};
function navigate() {
  const pages = ["triage","history","forecast"];
  const hash = location.hash.slice(1), active = pages.includes(hash) ? hash : "triage";
  for (const id of pages) {
    $(id).hidden = id !== active;
    const link = document.querySelector('nav a[href="#' + id + '"]');
    if (id === active) link.setAttribute("aria-current","page");
    else link.removeAttribute("aria-current");
  }
  if (active === "history") showHistory();
  if (active === "forecast") prepareForecast();
}
window.addEventListener("hashchange",navigate);
navigate();
restore();
