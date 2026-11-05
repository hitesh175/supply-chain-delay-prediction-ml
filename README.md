# Relay | Shipment operations

Relay ranks shipments by expected delay so you can decide which to review first. Open **Shipment triage** and choose **Try sample shipments**, or upload a CSV with the columns shipment_id, origin, destination, and shipping_mode. Review the queue, record decisions, and export a CSV before closing the page.

**Historical analytics** summarizes training data. **Check one shipment** runs the same predictor for one route and shipping mode.

## Run locally

From the repository root, serve the browser files and open http://localhost:8000.

    python -m http.server 8000 --directory web/dist

Python serves the files during local development. The browser downloads the pre-trained model on the first prediction and scores shipment data locally. No model training or Python server is needed on Vercel.

## Deploy a Vercel preview

Import the GitHub repository in Vercel. Select the relay-browser-vercel branch for a preview. Leave the root directory at the repository root. The checked-in Vercel configuration serves web/dist without a build command. Use Vercel Authentication if access should be restricted.

## Refresh the trained model

Install the Python dependencies and run these commands from the repository root.

    python -m pip install -r requirements.txt
    python web/export_model.py . web/dist
    python -m unittest discover -s tests -v

The exporter reads compressed_data.csv.gz or DataCoSupplyChainDataset.csv and writes the pre-trained forest and summary statistics. It also creates a local parity fixture at web/parity.json. The dataset and Python training code are outside the served directory. See the [DataCo dataset listing](https://www.kaggle.com/datasets/shashwatwork/dataco-smart-supply-chain-for-big-data-analysis) for usage terms.

The model estimates actual shipping days minus scheduled shipping days. Positive values indicate expected delay. Relay labels forecasts over two days late **Act now**, positive forecasts up to two days late **Watch**, and forecasts at or below zero **Monitor**.

The source labels Customer City as origin and Order City as destination. Validate that these fields represent physical shipment endpoints before using the model operationally. The model uses a random holdout split and integer city encodings. Evaluate it on representative future shipments before relying on it for operational decisions.

Historical reports are available in [output.pdf](output.pdf) and [Output2.pdf](Output2.pdf).
