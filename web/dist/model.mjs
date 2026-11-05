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
  const ids = new Set();
  return rows.map((row, index) => {
    const [id,origin,destination,mode] = positions.map(position => row[position]?.trim());
    if (row.length !== header.length || ![id,origin,destination,mode].every(Boolean)) {
      throw Error("Check the four required fields on shipment row " + (index + 1) + ".");
    }
    if (ids.has(id)) throw Error("Duplicate shipment ID: " + id);
    ids.add(id);
    let days;
    try { days = estimate([origin,destination,mode]); }
    catch (error) { throw Error(id + ": " + error.message); }
    return {id,origin,destination,mode,days,priority:priority(days),status:"New",note:""};
  }).sort((a,b) => b.days-a.days);
}

export function csvText(rows) {
  return rows.map(row => row.map(value => {
    let cell = String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"','""') + '"';
  }).join(",")).join("\r\n") + "\r\n";
}
