import streamlit as st
import pandas as pd
from pathlib import Path

# === Load Data ===
DATA_FILE = Path(__file__).parent / "data" / "players_2024_25_sample.csv"

@st.cache_data
def load_data():
    return pd.read_csv(DATA_FILE)

# === Recommend Squad Logic ===
def recommend_squad(df, budget=100):
    positions = {
        "GK": 2,
        "DEF": 5,
        "MID": 5,
        "FWD": 3
    }
    
    squad = []
    total_price = 0

    for pos, count in positions.items():
        players_pos = df[df["position"] == pos].sort_values(by="predicted_points", ascending=False)
        for _, player in players_pos.head(count).iterrows():
            if total_price + player["price"] <= budget:
                squad.append(player)
                total_price += player["price"]

    squad_df = pd.DataFrame(squad)
    total_points = squad_df["predicted_points"].sum()

    return squad_df, total_price, total_points

# === Streamlit UI ===
st.title("FPL Squad Optimiser")

budget = st.number_input("Enter your budget (£M)", min_value=50.0, max_value=100.0, value=100.0, step=0.1)

df = load_data()

if st.button("Generate Squad"):
    squad_df, total_price, total_points = recommend_squad(df, budget)
    st.subheader("Recommended Squad")
    st.dataframe(squad_df)
    st.subheader("Summary")
    st.write(f"**Total Price:** £{total_price:.1f}M")
    st.write(f"**Predicted Points:** {total_points:.1f}")
