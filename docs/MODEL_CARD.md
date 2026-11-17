# Relay model card

## Purpose and intended use
Rank a batch of shipments by expected delay so a person decides which to review first. It is a prompt to check, not a delivery promise, and it does not replace carrier tracking.

Not suitable for: customer promises, penalties, or automated decisions without a person reviewing the result.

## Data
DataCo Smart Supply Chain: 180,519 order lines in 65,752 orders. The target is actual shipping days minus scheduled days, so positive means late. Rows with missing fields or negative day counts are dropped. The dataset labels Customer City as origin and Order City as destination. Check that these are physical shipment endpoints before operational use. A few city names in the source are already corrupted (for example with replacement characters) and were not repaired.

## Model
Random Forest regression (50 trees, `min_samples_leaf=200`, seed 42) on three inputs: customer city, order city and shipping mode, each as an integer code. The forest is exported to JSON and scored in the browser.

## Evaluation
- **Split:** 80/20 by order id (`GroupShuffleSplit`), because lines of one order share the same route, mode and delay. Splitting by row leaks orders into the test set and reported 0.55 days of error.
- **Results on 13,151 unseen orders:** average error 1.00 days. A shipping-mode-only baseline (median delay per mode) scores 0.98 days.
- **Act now (forecast over 2 days):** precision 41%, recall 53%. The flagged group is 10.1% of shipments against a 7.8% base rate of truly late ones.
- **Likely range:** the forecast plus the 10th to 90th percentile of the model's misses for that shipping mode on unseen orders. For unseen routes it is the shipping mode's historical 10th to 90th percentile.
- **Tried and rejected:** smoothed per-city delay averages in place of city codes gave 0.99 days and no stable gain in recall or precision.

## Limits
- Delay in this data is driven mainly by shipping mode (First Class is always exactly 1 day late). Route adds little.
- Only past data from one dataset. No time-based split, so performance on future shipments is untested.
- No weather, carrier, congestion or order-date inputs.
- Routes outside the training data fall back to a mode average and are marked.

## Privacy
Uploaded files are parsed and scored in the browser. Decisions are saved in the browser's local storage and can be removed with Clear saved queue.
