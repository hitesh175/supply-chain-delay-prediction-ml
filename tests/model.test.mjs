import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { csvRows, csvText, makeEstimator, predict, priority, scoreCsv } from "../web/dist/model.mjs";

const meta = { classes: [["A","B"],["X","Y"],["Fast","Slow"]], mode_means: { Fast: 1, Slow: 3 }, residual_range: { Fast: [-1,1], Slow: [-2,2] }, mode_range: { Fast: [0,2], Slow: [1,5] } };
// One tree: split on mode code (feature 2) <= 0.5 -> 1.5 else 4.
const trees = [[[1,-1,-1],[2,-1,-1],[2,-1,-1],[0.5,-2,-2],[0,1.5,4]]];
const estimate = makeEstimator(meta, trees);

test("priority thresholds", () => {
  assert.deepEqual([3, 2, 0.5, 0, -1].map(priority), ["Act now","Watch","Watch","Monitor","Monitor"]);
});
test("known route uses the forest", () => {
  assert.deepEqual(estimate(["A","X","Fast"]), { days: 1.5, fallback: false, low: 0.5, high: 2.5 });
  assert.equal(predict(trees, [0,0,1]), 4);
});
test("unknown city falls back to the mode average and is flagged", () => {
  assert.deepEqual(estimate(["Nowhere","X","Slow"]), { days: 3, fallback: true, low: 1, high: 5 });
});
test("unknown shipping mode is an error", () => {
  assert.throws(() => estimate(["A","X","Teleport"]), /Unknown shipping mode/);
});
test("scoreCsv ranks by delay and rejects bad input", () => {
  const csv = "shipment_id,origin,destination,shipping_mode\n1,A,X,Fast\n2,A,X,Slow\n";
  assert.deepEqual(scoreCsv(csv, estimate).map(r => r.id), ["2","1"]);
  assert.throws(() => scoreCsv(csv + "1,A,X,Fast\n", estimate), error => error.problems[0].startsWith("Row 4: duplicate shipment ID 1"));
  assert.throws(() => scoreCsv("a,b\n1,2\n", estimate), /CSV headers/);
});
test("every bad row is reported with its spreadsheet row number", () => {
  const csv = "shipment_id,origin,destination,shipping_mode\n1,A,X,Teleport\n2,A,,Fast\n3,A,X,Fast\n3,B,Y,Slow\n";
  assert.throws(() => scoreCsv(csv, estimate), error => error.problems.length === 3
    && /^Row 2 \(1\): Unknown shipping mode/.test(error.problems[0])
    && /^Row 3:/.test(error.problems[1]) && /^Row 5: duplicate/.test(error.problems[2]));
});
test("csv parsing handles quotes and export blocks formula injection", () => {
  assert.deepEqual(csvRows('a,"b,""c"""\r\n1,2\n'), [["a",'b,"c"'],["1","2"]]);
  assert.match(csvText([["=SUM(A1)"]]), /"'=SUM\(A1\)"/);
});
test("exported forest matches scikit-learn on the parity fixture", { skip: !existsSync(new URL("../web/parity.json", import.meta.url)) }, () => {
  const forest = JSON.parse(gunzipSync(readFileSync(new URL("../web/dist/forest.json.gz", import.meta.url))));
  const [features, expected] = JSON.parse(readFileSync(new URL("../web/parity.json", import.meta.url)));
  features.forEach((row, i) => assert.ok(Math.abs(predict(forest, row) - expected[i]) < 1e-6));
});
