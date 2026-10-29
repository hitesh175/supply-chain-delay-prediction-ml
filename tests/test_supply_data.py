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
            model, origin, destination, mode, mae = train_model(frame)
            second = train_model(frame)
            self.assertAlmostEqual(mae, second[-1])
            self.assertGreaterEqual(mae, 0)
            self.assertNotIn("Origin_Code", frame)
            self.assertEqual(set(mode.classes_), {"Standard", "Express"})

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
