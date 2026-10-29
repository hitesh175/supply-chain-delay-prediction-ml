import streamlit as st
import pandas as pd
import plotly.express as px

from supply_data import find_dataset, load_shipments, train_model

st.set_page_config(page_title="Logistics AI Dashboard", layout="wide")


@st.cache_data
def load_data(path, modified_ns, size):
    # File metadata invalidates cached data after a local dataset change.
    return load_shipments(path)


cached_train_model = st.cache_resource(train_model)

st.title("🚚 Supply Chain: Delivery Delay Prediction")
st.markdown("Explore shipment history and estimate delivery delays using the DataCo dataset.")

try:
    path = find_dataset()
    info = path.stat()
    df = load_data(str(path), info.st_mtime_ns, info.st_size)
    model, le_origin, le_dest, le_mode, mae = cached_train_model(df)
except (OSError, ValueError, pd.errors.ParserError) as error:
    st.error(str(error))
    st.stop()

col1, col2, col3 = st.columns(3)
col1.metric("Total Orders Analyzed", f"{len(df):,}")
col2.metric("Avg Global Delay", f"{df['Delay_Duration'].mean():.2f} Days")
col3.metric("Mean Absolute Error (MAE)", f"{mae:.2f} Days", help="Average error in days.")

tab1, tab2 = st.tabs(["📊 Analytics Overview", "🤖 Live Prediction Tool"])

with tab1:
    st.subheader("Historical Performance")
    
    c1, c2 = st.columns(2)
    with c1:
        avg_delay_mode = df.groupby('Shipping_Mode')['Delay_Duration'].mean().reset_index()
        fig_mode = px.bar(avg_delay_mode, x='Shipping_Mode', y='Delay_Duration', 
                         title="Average Delay by Shipping Mode", color='Delay_Duration', color_continuous_scale='RdYlGn_r')
        st.plotly_chart(fig_mode, use_container_width=True)
        
    with c2:
        fig_hist = px.histogram(df, x='Delay_Duration', nbins=20, 
                               title="Distribution of Delays (Days)", color_discrete_sequence=['#3366CC'])
        st.plotly_chart(fig_hist, use_container_width=True)

    st.subheader("Regional Analysis")
    top_delay_cities = df.groupby('Destination')['Delay_Duration'].mean().sort_values(ascending=False).head(10).reset_index()
    fig_cities = px.bar(top_delay_cities, x='Delay_Duration', y='Destination', orientation='h',
                        title="Top 10 Cities with Highest Average Delays")
    st.plotly_chart(fig_cities, use_container_width=True)

with tab2:
    st.sidebar.header("Predict New Shipment")
    st.subheader("Predict Delay for a New Order")
    
    top_origins = df['Origin'].value_counts().head(50).index
    top_dests = df['Destination'].value_counts().head(50).index
    
    input_origin = st.selectbox("Origin City", sorted(top_origins))
    input_dest = st.selectbox("Destination City", sorted(top_dests))
    input_mode = st.selectbox("Shipping Mode", le_mode.classes_)
    
    if st.button("Predict Delay"):
        try:
            if input_origin in le_origin.classes_ and input_dest in le_dest.classes_:
                in_orig_enc = le_origin.transform([input_origin])[0]
                in_dest_enc = le_dest.transform([input_dest])[0]
                in_mode_enc = le_mode.transform([input_mode])[0]
                
                input_data = pd.DataFrame([[in_orig_enc, in_dest_enc, in_mode_enc]], 
                                        columns=['Origin_Code', 'Dest_Code', 'Mode_Code'])
                
                prediction = model.predict(input_data)[0]
                
                st.divider()
                st.metric("Predicted Delay", f"{prediction:.2f} Days")
                
                if prediction > 2.0:
                    st.error("⚠️ Risk: Significant delay expected.")
                elif prediction > 0:
                    st.warning("⚠️ Risk: Minor delay expected.")
                else:
                    st.success("✅ Good News: Expected to arrive on time or early.")
            else:
                st.warning("Selected city not found in training data (LabelEncoder error).")
        except Exception as e:
            st.error(f"Prediction Error: {e}")
