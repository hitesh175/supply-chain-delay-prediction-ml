"""Portable data loading and model fitting, independent of the UI."""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
SOURCES = ("DataCoSupplyChainDataset.csv", "compressed_data.csv.gz")
COLUMNS = {
    "Shipping Mode": "Shipping_Mode",
    "Order City": "Destination",
    "Customer City": "Origin",
    "Order Region": "Region",
}
DAYS = ("Days for shipping (real)", "Days for shipment (scheduled)")


def find_dataset(root=ROOT):
    for name in SOURCES:
        candidate = Path(root) / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("Place DataCoSupplyChainDataset.csv or compressed_data.csv.gz beside app.py.")


def load_shipments(path):
    raw = pd.read_csv(path, encoding="latin-1")
    missing = sorted(set(COLUMNS).union(DAYS) - set(raw.columns))
    if missing:
        raise ValueError("Missing dataset columns: " + ", ".join(missing))
    frame = raw[list(COLUMNS)].rename(columns=COLUMNS)
    for column in frame:
        frame[column] = frame[column].astype("string").str.strip().replace("", pd.NA)
    actual = pd.to_numeric(raw[DAYS[0]], errors="coerce")
    scheduled = pd.to_numeric(raw[DAYS[1]], errors="coerce")
    frame["Delay_Duration"] = actual - scheduled
    valid_days = np.isfinite(actual) & np.isfinite(scheduled) & (actual >= 0) & (scheduled >= 0)
    frame = frame.loc[valid_days].dropna().reset_index(drop=True)
    if len(frame) < 5:
        raise ValueError("At least five valid shipments are required to train and evaluate the model.")
    return frame


def train_model(frame):
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.metrics import mean_absolute_error
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import LabelEncoder

    frame = frame.copy()
    encoders = [LabelEncoder().fit(frame[column]) for column in ("Origin", "Destination", "Shipping_Mode")]
    feature_columns = ("Origin_Code", "Dest_Code", "Mode_Code")
    for source, target, encoder in zip(("Origin", "Destination", "Shipping_Mode"), feature_columns, encoders):
        frame[target] = encoder.transform(frame[source])
    features = frame[list(feature_columns)]
    x_train, x_test, y_train, y_test = train_test_split(
        features, frame["Delay_Duration"], test_size=0.2, random_state=42
    )
    model = RandomForestRegressor(n_estimators=50, random_state=42)
    model.fit(x_train, y_train)
    mae = mean_absolute_error(y_test, model.predict(x_test))
    return model, *encoders, mae
