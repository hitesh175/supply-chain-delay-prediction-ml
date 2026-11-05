import { predict, scoreCsv, priority, columns, csvText } from "./model.mjs";

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
  const codes = meta.classes.map(values => new Map(values.map((value, index) => [value,index])));
  return values => {
    const features = values.map((value,index) => {
      if (!codes[index].has(value)) throw Error("Unknown " + ["origin","destination","shipping mode"][index] + ' "' + value + '". Use a value from Check one shipment.');
      return codes[index].get(value);
    });
    return predict(trees,features);
  };
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
    first.append(button,node("small",origin + " → " + destination));
    const priorityCell = node("td");
    priorityCell.append(node("span",rank,"tag " + (rank === "Act now" ? "urgent" : rank === "Watch" ? "watch" : "")));
    tr.append(first,node("td",timing(days)),priorityCell,node("td",status));
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
  fragment.querySelector(".estimate").textContent = timing(shipment.days) + " · " + shipment.priority;
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
    renderQueue();
    feedback("save-status","Decision saved for " + shipment.id + ".");
    ($("review-title") || $("resolved")).focus();
  };
  detail.append(fragment);
}
async function loadBatch(read, label) {
  for (const id of ["score","sample"]) $(id).disabled = true;
  feedback("load-status","Scoring shipments…");
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
    feedback("save-status","");
    renderQueue();
    feedback("load-status",queue.length + " shipments scored.");
  } catch (error) {
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
$("export").onclick = () => {
  const csv = csvText([[...columns,"predicted_delay_days","priority","status","decision_note"],...queue.map(s => [s.id,s.origin,s.destination,s.mode,s.days,s.priority,s.status,s.note])]);
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
    totals("history-totals",[["historical orders",meta.orders.toLocaleString()],["average delay",meta.mean.toFixed(2) + " d"],["average prediction error",meta.mae.toFixed(2) + " d"]]);
    const averages = values => values.map(([label,value]) => [label,value.toFixed(2)]);
    $("charts").replaceChildren(
      historyTable("Average delay by shipping mode",["Shipping mode","Average delay (days)"],averages(meta.modes),true),
      historyTable("Destinations with the highest average delays",["Destination","Average delay (days)"],averages(meta.destinations),true),
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
    const days = estimate(["origin","destination","mode"].map(id => $(id).value.trim()));
    feedback("forecast-status",timing(days) + " · " + priority(days));
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
