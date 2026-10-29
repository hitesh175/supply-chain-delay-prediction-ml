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

The source labels Customer City as “Origin” and Order City as “Destination”. These fields require domain validation before treating them as physical shipment endpoints. MAE is an error measure, although the current interface labels it “Model Accuracy”.

## Run locally

```bash
python -m venv .venv
python -m pip install pandas numpy scikit-learn streamlit plotly
python -m streamlit run app.py
```

Activate the environment before installation. Before launching, place a CSV named `DataCoSupplyChainDataset.csv` beside `app.py`. It must include shipping-day, city, mode, and region fields used by the source.

A dataset reference is linked in the [DataCo dataset listing](https://www.kaggle.com/datasets/shashwatwork/dataco-smart-supply-chain-for-big-data-analysis). Follow its applicable access and usage terms.

The repository includes `compressed_data.csv.gz`, but the app currently reads the uncompressed CSV name above. Inspect the archive's schema before extracting it for use.

## Project material

- [app.py](app.py): loading, feature encoding, training, charts, and predictions.
- [output.pdf](output.pdf) and [Output2.pdf](Output2.pdf): saved output documents.
- Repository screenshots: interface examples.

## Limitations

This is a demonstration, with no committed dependency lockfile or independent temporal evaluation. The model retrains when the app script reruns. A random split and integer city encodings limit conclusions about future shipments or unseen locations. Risk messages use fixed prediction thresholds rather than calibrated probabilities.
