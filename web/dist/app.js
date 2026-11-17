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
function dayPart(value) {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return rounded === 0 ? "on time" : rounded + " d " + (value > 0 ? "late" : "early");
}
function rangeText(low, high) { return dayPart(low) + " to " + dayPart(high); }
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, parent) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  parent?.append(element);
  return element;
}
const priorityClass = rank => rank === "Act now" ? "p-act" : rank === "Watch" ? "p-watch" : "p-monitor";
// Number line from 3 days early to 6 days late: the dot is the forecast, the bar is the likely range,
// the dashed line is where "Act now" starts. Text next to it always says the same thing in words.
function gauge(shipment, large = false) {
  const [min, max] = [-3, 6], width = large ? 320 : 220, pad = 8, height = large ? 52 : 22, mid = large ? 18 : 11;
  const x = value => pad + (Math.min(max, Math.max(min, value)) - min) / (max - min) * (width - pad * 2);
  const root = svg("svg", {viewBox: `0 0 ${width} ${height}`, class: "gauge " + priorityClass(shipment.priority), role: "img",
    "aria-label": `${timing(shipment.days)}, likely range ${shipment.low.toFixed(1)} to ${shipment.high.toFixed(1)} days`});
  svg("line", {x1: pad, x2: width - pad, y1: mid, y2: mid, class: "track"}, root);
  svg("line", {x1: x(0), x2: x(0), y1: mid - 6, y2: mid + 6, class: "zero"}, root);
  svg("line", {x1: x(2), x2: x(2), y1: mid - 9, y2: mid + 9, class: "limit"}, root);
  const left = x(shipment.low), right = x(shipment.high);
  svg("rect", {x: left, y: mid - 5, width: Math.max(3, right - left), height: 10, rx: 5, class: "span"}, root);
  svg("circle", {cx: x(shipment.days), cy: mid, r: large ? 7 : 5.5, class: "mark"}, root);
  if (large) {
    for (const [value, label] of [[-2, "2 early"], [0, "on time"], [4, "4 late"], [6, "6+ late"]]) {
      const text = svg("text", {x: x(value), y: 46, "text-anchor": value === 6 ? "end" : "middle"}, root);
      text.textContent = label;
    }
    const limit = svg("text", {x: x(2), y: 46, "text-anchor": "middle", class: "limit-label"}, root);
    limit.textContent = "2 late";
  }
  return root;
}
function totals(id, items) {
  $(id).replaceChildren(...items.map(([label, value]) => {
    const span = node("span");
    span.append(node("strong",value),label);
    return span;
  }));
}
function renderMix(open, resolved) {
  const counts = {"Act now": 0, "Watch": 0, "Monitor": 0};
  for (const row of open) counts[row.priority]++;
  const wrap = node("div", undefined, "mix"), bar = node("div", undefined, "mix-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${open.length} open shipments: ${counts["Act now"]} act now, ${counts.Watch} watch, ${counts.Monitor} monitor`);
  for (const [rank, count] of Object.entries(counts)) if (count) {
    const part = node("i", undefined, priorityClass(rank));
    part.style.flex = String(count);
    bar.append(part);
  }
  const legend = node("div", undefined, "mix-legend");
  for (const [rank, count] of Object.entries(counts)) {
    const item = node("span");
    item.append(node("span", undefined, "dot " + priorityClass(rank)), node("b", String(count)), rank);
    legend.append(item);
  }
  const done = node("span"); done.append(node("b", String(resolved)), "resolved");
  legend.append(done);
  wrap.append(bar, legend);
  $("totals").replaceChildren(wrap);
}
function renderQueue() {
  $("triage").classList.add("has-queue");
  const open = queue.filter(row => row.status !== "Resolved");
  const visible = $("resolved").checked ? queue : open;
  if (!visible.some(row => row.id === selected)) selected = visible[0]?.id;
  renderMix(open, queue.length - open.length);
  $("rows").replaceChildren();
  for (const shipment of visible) {
    const {id,origin,destination,days,priority:rank,status} = shipment;
    const tr = node("tr",undefined,priorityClass(rank) + (id === selected ? " active" : ""));
    const first = node("td");
    const button = node("button",id,"pick");
    button.setAttribute("aria-pressed",String(id === selected));
    button.onclick = () => { selected = id; feedback("save-status",""); renderQueue(); $("review-title").focus(); };
    first.append(button,node("small",origin + " → " + destination),node("small",status,"mobile-status"));
    const priorityCell = node("td");
    priorityCell.append(node("span",rank,"tag " + priorityClass(rank)));
    const forecastCell = node("td"), fc = node("div",undefined,"fc"), text = node("span",timing(days),"fc-text");
    if (shipment.fallback) { const chip = node("span","mode average","chip"); chip.title = "This route was not in the training data, so the shipping mode's historical average is used."; text.append(chip); }
    fc.append(text,gauge(shipment));
    forecastCell.append(fc);
    tr.append(first,forecastCell,priorityCell,node("td",status,"shipment-status"));
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
  const estimate = fragment.querySelector(".estimate");
  estimate.textContent = timing(shipment.days) + " (" + shipment.priority + ")";
  estimate.closest("dl").classList.add(priorityClass(shipment.priority));
  fragment.querySelector(".gauge-slot").append(gauge(shipment,true));
  fragment.querySelector(".range").textContent = rangeText(shipment.low, shipment.high);
  fragment.querySelector(".basis").textContent = shipment.fallback
    ? "The shipping mode's historical average. This route was not in the training data."
    : "This route's history in the training data.";
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
$("file").onchange = () => { $("file-name").textContent = $("file").files[0]?.name ?? "Choose a shipment CSV"; };
for (const type of ["dragenter","dragover"]) $("drop").addEventListener(type, event => { event.preventDefault(); $("drop").classList.add("over"); });
for (const type of ["dragleave","drop"]) $("drop").addEventListener(type, () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", event => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("file").files = transfer.files;
  $("file").dispatchEvent(new Event("change"));
});
$("clear").onclick = () => {
  if (!confirm("Remove the saved queue and all decisions from this browser? Export first if you want a copy.")) return;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  queue = []; selected = batchText = undefined;
  $("workspace").hidden = true;
  $("empty-queue").hidden = false;
  $("triage").classList.remove("has-queue");
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
    row.append(...values.map(value => {
      const cell = node("td");
      if (value && typeof value === "object") {
        const wrap = node("div", undefined, "bar-cell"), fill = node("i");
        fill.style.width = Math.round(value.bar * 120) + "px";
        wrap.append(fill, value.text);
        cell.append(wrap);
      } else cell.textContent = value;
      return cell;
    }));
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
    const top = Math.max(meta.mae, meta.baseline_mae) * 1.15;
    const bars = [["Relay forecast", meta.mae, ""], ["Guessing each shipping mode's typical delay", meta.baseline_mae, " base"]].map(([label, value, extra]) => {
      const row = node("div", undefined, "rel-row" + extra), bar = node("div", undefined, "rel-bar"), fill = node("i");
      fill.style.width = (value / top * 100) + "%";
      bar.append(fill);
      row.append(node("span", label), bar, node("b", value.toFixed(2) + " d"));
      return row;
    });
    const reliability = node("div", undefined, "reliability");
    reliability.append(node("h2", "Average error on orders the model never saw"), ...bars,
      node("p", `Measured on ${meta.test_orders.toLocaleString()} held-out orders. Route history adds little over the shipping mode for average error, so use the ranking to decide what to check first, not as a delivery promise. Flagging ${share(meta.act_flagged_share)} of shipments as Act now finds ${pct(meta.act_recall)} of the ones that really ran over 2 days late (${share(meta.act_base_rate)} of all shipments), and ${pct(meta.act_precision)} of the flagged ones were late.`, "rel-note"));
    $("reliability").replaceChildren(reliability);
    totals("history-totals",[["order lines in the training records",meta.orders.toLocaleString()],["average delay",meta.mean.toFixed(2) + " d"]]);
    $("history-note").textContent = "";
    const days = value => { const text = value.toFixed(2); return text === "-0.00" ? "0.00" : text; };
    const widest = Math.max(...meta.modes.concat(meta.destinations).map(([, value]) => Math.abs(value)), 1);
    const averages = values => values.map(([label,value,count]) => [label,{bar: Math.abs(value) / widest, text: days(value)},count.toLocaleString()]);
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
    const shipment = {days, low, high, priority: priority(days)};
    feedback("forecast-status",timing(days) + ", " + shipment.priority);
    const note = node("p", "Likely range: " + rangeText(low, high) + ". " + (fallback ? "This route was not in the training data, so this is the shipping mode's historical average." : "Based on this route's history."), "forecast-sub");
    $("forecast-gauge").replaceChildren(note, gauge(shipment, true));
    $("forecast-status").className = "feedback forecast-result " + priorityClass(shipment.priority);
  } catch (error) { $("forecast-gauge").replaceChildren(); feedback("forecast-status",error.message,true); }
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
