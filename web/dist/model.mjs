export function predict(trees, features) {
  let sum = 0;
  for (const [left,right,feature,threshold,value] of trees) {
    let node = 0;
    while (left[node] !== -1) {
      node = features[feature[node]] <= threshold[node] ? left[node] : right[node];
    }
    sum += value[node];
  }
  return sum / trees.length;
}

export function csvRows(source) {
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  const input = source.replace(/^\uFEFF/, "");
  function endField() {
    row.push(field);
    field = "";
    closed = false;
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i+1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === ",") endField();
    else if (char === "\r" || char === "\n") {
      endField();
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      if (char === "\r" && input[i+1] === "\n") i++;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw Error("Check the quotation marks in your CSV.");
    else field += char;
  }
  if (quoted) throw Error("A quoted field in the CSV is unfinished.");
  endField();
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export const columns = ["shipment_id","origin","destination","shipping_mode"];
export const priority = days => days > 2 ? "Act now" : days > 0 ? "Watch" : "Monitor";
export function scoreCsv(source, estimate) {
  const [header = [], ...rows] = csvRows(source);
  const positions = columns.map(column => header.findIndex(value => value.trim() === column));
  if (positions.includes(-1)) throw Error("Use these CSV headers: " + columns.join(", ") + ".");
  if (!rows.length) throw Error("Add at least one shipment below the header row.");
  const ids = new Set(), problems = [], scored = [];
  rows.forEach((row, index) => {
    const line = index + 2; // spreadsheet row, counting the header as row 1
    const [id,origin,destination,mode] = positions.map(position => row[position]?.trim());
    if (row.length !== header.length || ![id,origin,destination,mode].every(Boolean)) {
      problems.push("Row " + line + ": fill all four fields and keep the same number of columns as the header.");
      return;
    }
    if (ids.has(id)) { problems.push("Row " + line + ": duplicate shipment ID " + id + "."); return; }
    ids.add(id);
    try {
      const {days,fallback,low,high} = estimate([origin,destination,mode]);
      scored.push({id,origin,destination,mode,days,fallback,low,high,priority:priority(days),status:"New",note:""});
    } catch (error) { problems.push("Row " + line + " (" + id + "): " + error.message); }
  });
  if (problems.length) {
    const shown = problems.slice(0, 25);
    if (problems.length > shown.length) shown.push("…and " + (problems.length - shown.length) + " more.");
    throw Object.assign(Error(problems.length + " row" + (problems.length > 1 ? "s need" : " needs") + " fixing before this batch can be scored."), {problems: shown});
  }
  return scored.sort((a,b) => b.days-a.days);
}

// Route-specific scoring when both cities were seen in training; otherwise the
// historical average of the shipping mode, flagged so the reader can discount it.
export function makeEstimator(meta, trees) {
  const codes = meta.classes.map(values => new Map(values.map((value, index) => [value,index])));
  return ([origin,destination,mode]) => {
    if (!codes[2].has(mode)) throw Error('Unknown shipping mode "' + mode + '". Use one of: ' + meta.classes[2].join(", ") + ".");
    const known = [origin,destination].map((value,index) => codes[index].get(value));
    // Range: 10th to 90th percentile of what similar shipments actually did.
    if (known.some(code => code === undefined)) {
      const [low,high] = meta.mode_range[mode];
      return {days: meta.mode_means[mode], fallback: true, low, high};
    }
    const days = predict(trees,[...known,codes[2].get(mode)]);
    const [below,above] = meta.residual_range[mode];
    return {days, fallback: false, low: days + below, high: days + above};
  };
}

export function csvText(rows) {
  return rows.map(row => row.map(value => {
    let cell = String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"','""') + '"';
  }).join(",")).join("\r\n") + "\r\n";
}
