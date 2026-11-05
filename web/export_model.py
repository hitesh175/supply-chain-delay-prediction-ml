"""Export the existing forest and aggregate history for browser inference."""
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

source, output = map(Path, sys.argv[1:])
sys.path.insert(0, str(source.resolve()))
from supply_data import find_dataset, load_shipments, train_model

frame = load_shipments(find_dataset(source))
model, *encoders, mae = train_model(frame)
output.mkdir(parents=True, exist_ok=True)
trees = []
for estimator in model.estimators_:
    tree = estimator.tree_
    trees.append([
        tree.children_left.tolist(), tree.children_right.tolist(),
        tree.feature.tolist(), tree.threshold.tolist(),
        tree.value[:, 0, 0].tolist(),
    ])
with gzip.open(output / "forest.json.gz", "wt", encoding="utf-8") as file:
    json.dump(trees, file, separators=(",", ":"), allow_nan=False)
histogram = frame.Delay_Duration.value_counts().sort_index()
def grouped(column, limit=None):
    means = frame.groupby(column).Delay_Duration.mean().sort_values(ascending=False)
    return [[str(key), float(value)] for key, value in means.head(limit or len(means)).items()]
meta = {
    "classes": [encoder.classes_.tolist() for encoder in encoders],
    "orders": len(frame), "mean": float(frame.Delay_Duration.mean()), "mae": float(mae),
    "modes": grouped("Shipping_Mode"), "destinations": grouped("Destination", 10),
    "histogram": [[float(key), int(value)] for key, value in histogram.items()],
}
(output / "model-info.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
features = pd.DataFrame(
    np.column_stack([encoder.transform(frame[column]) for encoder, column in zip(encoders, ["Origin", "Destination", "Shipping_Mode"])]),
    columns=model.feature_names_in_,
).sample(n=1000, random_state=42)
(output.parent / "parity.json").write_text(json.dumps([features.values.tolist(), model.predict(features).tolist()]))
