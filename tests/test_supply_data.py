import gzip
import sys
import tempfile
from pathlib import Path
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1]))
from supply_data import find_dataset, load_shipments, train_model


def sample():
    return pd.DataFrame({
        "Order Id": [i // 2 for i in range(20)],
        "Shipping Mode": ["Standard", "Express"] * 10,
        "Order City": ["City A", "City B"] * 10,
        "Customer City": ["Town A", "Town B"] * 10,
        "Order Region": ["Region"] * 20,
        "Days for shipping (real)": [3, 2, 5, 4] * 5,
        "Days for shipment (scheduled)": [2, 2, 3, 3] * 5,
    })


class ShipmentTests(unittest.TestCase):
    def test_compressed_input_and_repeatable_model(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "compressed_data.csv.gz"
            sample().to_csv(path, index=False, compression="gzip")
            self.assertEqual(find_dataset(directory), path)
            frame = load_shipments(path)
            self.assertEqual(len(frame), 20)
            model, origin, destination, mode, metrics = train_model(frame)
            second = train_model(frame)
            self.assertAlmostEqual(metrics["mae"], second[-1]["mae"])
            self.assertGreaterEqual(metrics["mae"], 0)
            self.assertGreaterEqual(metrics["baseline_mae"], 0)
            for low, high in metrics["residual_range"].values():
                self.assertLessEqual(low, high)
            self.assertNotIn("Origin_Code", frame)
            self.assertEqual(set(mode.classes_), {"Standard", "Express"})

    def test_holdout_keeps_each_order_together(self):
        from sklearn.model_selection import GroupShuffleSplit
        frame = pd.DataFrame({"Order_Id": [str(i // 4) for i in range(40)]})
        train, test = next(GroupShuffleSplit(1, test_size=0.2, random_state=42).split(frame, groups=frame.Order_Id))
        self.assertFalse(set(frame.Order_Id.iloc[train]) & set(frame.Order_Id.iloc[test]))

    def test_single_order_cannot_be_evaluated(self):
        frame = load_shipments(self._write(sample().assign(**{"Order Id": 1})))
        with self.assertRaisesRegex(ValueError, "two distinct orders"):
            train_model(frame)

    def _write(self, frame):
        directory = tempfile.mkdtemp()
        path = Path(directory) / "data.csv"
        frame.to_csv(path, index=False)
        return path

    def test_invalid_schema_has_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.csv"
            pd.DataFrame({"wrong": [1]}).to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "Missing dataset columns"):
                load_shipments(path)

    def test_invalid_days_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            frame = sample()
            frame.loc[0, "Days for shipping (real)"] = -1
            frame.to_csv(path, index=False)
            self.assertEqual(len(load_shipments(path)), 19)


if __name__ == "__main__":
    unittest.main()
