"""Portable data loading and model fitting, independent of the UI."""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
SOURCES = ("DataCoSupplyChainDataset.csv", "compressed_data.csv.gz")
COLUMNS = {
    "Order Id": "Order_Id",
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


ACT_NOW_DAYS = 2
FOREST = {"n_estimators": 50, "min_samples_leaf": 200, "random_state": 42}


def train_model(frame):
    """Fit the forest and evaluate it on orders it never saw.

    A dataset row is an order line, and lines of one order share route, mode and
    delay. Splitting by row would put the same order in train and test and make
    the error look far better than it is, so the holdout is split by order.
    """
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.metrics import mean_absolute_error
    from sklearn.model_selection import GroupShuffleSplit
    from sklearn.preprocessing import LabelEncoder

    frame = frame.copy()
    if frame["Order_Id"].nunique() < 2:
        raise ValueError("At least two distinct orders are required to hold out unseen orders.")
    encoders = [LabelEncoder().fit(frame[column]) for column in ("Origin", "Destination", "Shipping_Mode")]
    feature_columns = ("Origin_Code", "Dest_Code", "Mode_Code")
    for source, target, encoder in zip(("Origin", "Destination", "Shipping_Mode"), feature_columns, encoders):
        frame[target] = encoder.transform(frame[source])
    train_index, test_index = next(
        GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42).split(frame, groups=frame["Order_Id"])
    )
    train, test = frame.iloc[train_index], frame.iloc[test_index]
    model = RandomForestRegressor(**FOREST)
    model.fit(train[list(feature_columns)], train["Delay_Duration"])
    predicted = model.predict(test[list(feature_columns)])
    actual = test["Delay_Duration"].to_numpy()
    # Reference: the typical delay of each shipping mode, learned on the same training orders.
    mode_median = train.groupby("Shipping_Mode")["Delay_Duration"].median()
    baseline = test["Shipping_Mode"].map(mode_median).fillna(train["Delay_Duration"].median()).to_numpy()
    flagged, late = predicted > ACT_NOW_DAYS, actual > ACT_NOW_DAYS
    hits = int((flagged & late).sum())
    # How far real delays land from the forecast, per shipping mode, on unseen orders.
    residual = pd.Series(actual - predicted, index=test["Shipping_Mode"].to_numpy())
    spread = {
        mode: [float(group.quantile(0.1)), float(group.quantile(0.9))]
        for mode, group in residual.groupby(level=0)
    }
    metrics = {
        "residual_range": spread,
        "mae": float(mean_absolute_error(actual, predicted)),
        "baseline_mae": float(mean_absolute_error(actual, baseline)),
        "act_precision": hits / int(flagged.sum()) if flagged.any() else None,
        "act_recall": hits / int(late.sum()) if late.any() else None,
        "test_orders": int(test["Order_Id"].nunique()),
        "act_base_rate": float(late.mean()),
        "act_flagged_share": float(flagged.mean()),
    }
    return model, *encoders, metrics
