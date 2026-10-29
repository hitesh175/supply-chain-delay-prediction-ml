# Supply Chain Delivery Delay Prediction

A Streamlit prototype combining shipment analytics with a Random Forest regression model.

The app estimates delivery delay in days and groups predictions into on-time/early, minor-delay, and significant-delay messages.

![Dashboard example](Screenshot%202026-01-30%20120900.png)

## How it works

- Target: actual shipping days minus scheduled shipping days.
- Features: encoded customer city, order city, and shipping mode.
- Evaluation: an 80/20 random split with a fixed seed.
- Metric: mean absolute error (MAE), measured in days.
- Interface: historical charts, regional comparisons, and interactive predictions.

The source labels Customer City as “Origin” and Order City as “Destination”. These fields require domain validation before treating them as physical shipment endpoints. MAE reports prediction error in days; lower values are better.

## Run locally

```bash
python -m venv .venv
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

Activate the environment before installation. The loader finds `DataCoSupplyChainDataset.csv` or the included `compressed_data.csv.gz` beside the application. When both exist, it prefers the uncompressed CSV. It validates required columns, removes invalid shipping-day rows, and reports actionable input errors.

A dataset reference is linked in the [DataCo dataset listing](https://www.kaggle.com/datasets/shashwatwork/dataco-smart-supply-chain-for-big-data-analysis). Follow its applicable access and usage terms.

Both plain and gzip-compressed CSV inputs are read directly. Dataset paths are resolved relative to the application rather than the launch directory.

## Project material

- [app.py](app.py): cached application loading, charts, and predictions.
- [supply_data.py](supply_data.py): file discovery, schema validation, and model fitting.
- [output.pdf](output.pdf) and [Output2.pdf](Output2.pdf): saved output documents.
- Repository screenshots: interface examples.

## Limitations

This is a demonstration, with no committed dependency lockfile or independent temporal evaluation. Dataset loading and model fitting are cached across interface interactions. Changes to the selected file's size or modification time invalidate its data cache; changed input data invalidates the model cache. A random split and integer city encodings limit conclusions about future shipments or unseen locations. Risk messages use fixed prediction thresholds rather than calibrated probabilities.

## Regression checks

```bash
python -m unittest discover -s tests -v
```

Tests use synthetic shipments to check compressed input, schema errors, invalid shipping durations, and deterministic model fitting. They do not establish predictive accuracy on operational shipments.
