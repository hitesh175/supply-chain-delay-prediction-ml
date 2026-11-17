"""Batch scoring and shipment decisions for the original delay predictor."""
import hashlib
from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st

INPUTS = ["shipment_id", "origin", "destination", "shipping_mode"]
FEATURES = ["Origin_Code", "Dest_Code", "Mode_Code"]
STATUSES = ["New", "Investigating", "Action taken", "Resolved"]
ACTIONS = {
    "Act now": "Confirm the revised ETA and ask about recovery options.",
    "Watch": "Verify the next shipping milestone and set a follow-up.",
    "Monitor": "Review the next routine tracking update.",
}


def score_shipments(frame, model, encoders):
    missing = [column for column in INPUTS if column not in frame]
    if missing:
        raise ValueError("Missing columns: " + ", ".join(missing))
    queue = frame[INPUTS].fillna("").apply(lambda column: column.str.strip())
    if queue.empty or queue.eq("").any().any():
        raise ValueError("Supply at least one shipment and fill all four fields on each row.")
    if queue["shipment_id"].duplicated().any():
        raise ValueError("Use a unique shipment_id for each row.")

    encoded = {}
    for column, feature, encoder in zip(INPUTS[1:], FEATURES, encoders):
        unknown = ~queue[column].isin(encoder.classes_)
        if unknown.any():
            examples = ", ".join(queue.loc[unknown, column].drop_duplicates().head(5))
            raise ValueError(f"Unrecognized values in {column}: {examples}")
        encoded[feature] = encoder.transform(queue[column])
    queue["predicted_delay_days"] = model.predict(pd.DataFrame(encoded))
    queue["priority"] = queue["predicted_delay_days"].map(
        lambda days: "Act now" if days > 2 else "Watch" if days > 0 else "Monitor"
    )
    return queue.sort_values("predicted_delay_days", ascending=False, kind="stable")



def show_triage(model, encoders):
    st.header("Shipment triage")
    st.write("Find which shipments to check first. Relay predicts how early or late each shipment will be and puts the longest delays at the top.")

    st.subheader("1. Load shipments")
    state = st.session_state
    with st.expander("Choose a shipment file", expanded="triage_queue" not in state):
        upload = st.file_uploader("Shipment CSV", type="csv")
        load_col, sample_col, template_col = st.columns(3)
        load = load_col.button("Score uploaded shipments", disabled=upload is None, type="primary")
        sample = sample_col.button("Try sample shipments")
        example = pd.DataFrame(
            [["SH-001", *(encoder.classes_[0] for encoder in encoders)]], columns=INPUTS
        )
        template_col.download_button("Download CSV template", example.to_csv(index=False), "shipments.csv", "text/csv")
        st.caption("Use one row per shipment with a unique ID, origin, destination, and shipping mode. Loading a different batch replaces this session’s queue.")
        if load or sample:
            try:
                name = "Sample shipments" if sample else upload.name
                data = Path(__file__).with_name("sample-shipments.csv").read_bytes() if sample else upload.getvalue()
                batch = hashlib.sha256(data).hexdigest()
                if state.get("triage_batch") != batch:
                    with st.spinner("Predicting shipment delays…"):
                        queue = score_shipments(pd.read_csv(BytesIO(data), dtype=str), model, encoders)
                    queue["status"] = "New"
                    queue["decision_note"] = ""
                    state.triage_queue = queue.set_index("shipment_id")
                    state.triage_batch = batch
                state.triage_source = name
                state.triage_sample = sample
                state.pop("triage_saved", None)
            except (OSError, ValueError) as error:
                st.error(f"Could not load this batch. {error}")

    if "triage_queue" not in state:
        st.info("Start with the sample shipments to see a ranked queue, or upload your own shipment list.")
        return

    queue = state.triage_queue
    batch = state.triage_batch
    st.divider()
    st.subheader("2. See what needs attention")
    source = "Sample batch" if state.triage_sample else f"Uploaded batch / {state.triage_source}"
    st.text(source)
    open_shipments = queue.loc[queue["status"] != "Resolved"]
    urgent = (open_shipments["priority"] == "Act now").sum()
    st.write(f"**{urgent} need attention now** · {len(open_shipments)} open · {len(queue) - len(open_shipments)} resolved")
    st.caption("Act now: over 2 days late. Watch: up to 2 days late. Monitor: on time or early.")

    queue_panel, review_panel = st.columns([3, 2], gap="large")
    with queue_panel:
        show_resolved = st.checkbox("Include resolved shipments")
        visible = queue if show_resolved else open_shipments
        table = visible.drop(columns="decision_note").reset_index()
        table["route"] = table["origin"] + " → " + table["destination"]
        st.dataframe(
            table[["shipment_id", "route", "predicted_delay_days", "priority", "status"]],
            hide_index=True,
            use_container_width=True,
            column_config={
                "shipment_id": "Shipment",
                "route": "Route",
                "predicted_delay_days": st.column_config.NumberColumn(
                    "Days late", format="%.2f", help="Negative values mean early. Priority uses the unrounded estimate."
                ),
                "priority": "Priority",
                "status": "Your status",
            },
        )
        st.download_button("Export results and decisions", queue.to_csv(), "triage-results.csv", "text/csv")
        st.caption("The export includes all shipments. Decisions stay in this session until you load a different batch.")

    with review_panel:
        st.subheader("3. Record your decision")
        saved = state.pop("triage_saved", None)
        if saved:
            st.success(f"Decision saved for {saved}.")
        if visible.empty:
            st.info("All shipments in this batch are resolved. Include resolved shipments to review them.")
            return
        shipment_id = st.selectbox("Shipment to review", visible.index, key=f"review-{batch}")
        shipment = queue.loc[shipment_id]
        days = shipment["predicted_delay_days"]
        timing = f"{abs(days):.2f} days {'late' if days > 0 else 'early'}" if days else "on time"
        st.text(f"{shipment['origin']} → {shipment['destination']}  /  {shipment['shipping_mode']}")
        st.write(f"**Model estimate**  \n{timing.capitalize()} · {shipment['priority']}")
        st.write(f"**Suggested next action**  \n{ACTIONS[shipment['priority']]}")
        with st.form(f"decision-{batch}-{shipment_id}"):
            status = st.selectbox("Your status", STATUSES, index=STATUSES.index(shipment["status"]))
            note = st.text_area("Decision note", shipment["decision_note"], placeholder="What will you do, and when will you check back?")
            if st.form_submit_button("Save decision", type="primary"):
                queue.loc[shipment_id, ["status", "decision_note"]] = [status, note.strip()]
                state.triage_saved = shipment_id
                st.rerun()


