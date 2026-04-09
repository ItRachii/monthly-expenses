import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from utils.calculations import add_owe_columns

PALETTE = px.colors.qualitative.Set3


def category_pie_chart(df: pd.DataFrame):
    """Donut chart of total spending by category."""
    data = df.groupby("category")["amount"].sum().reset_index()
    fig = px.pie(
        data,
        names="category",
        values="amount",
        title="Spending by Category",
        hole=0.35,
        color_discrete_sequence=PALETTE,
    )
    fig.update_traces(textposition="inside", textinfo="percent+label")
    fig.update_layout(showlegend=True)
    return fig


def category_bar_chart(df: pd.DataFrame):
    """Horizontal bar chart of spending by category, sorted descending."""
    data = (
        df.groupby("category")["amount"]
        .sum()
        .reset_index()
        .sort_values("amount", ascending=True)
    )
    fig = px.bar(
        data,
        x="amount",
        y="category",
        orientation="h",
        title="Spending by Category",
        labels={"amount": "Total (₹)", "category": "Category"},
        color="category",
        color_discrete_sequence=PALETTE,
    )
    fig.update_layout(showlegend=False, yaxis_title="")
    return fig


def per_person_bar_chart(df: pd.DataFrame, user_names: dict = None):
    """Grouped bar: what each person paid vs. what their share is."""
    if user_names is None:
        user_names = {"Person A": "Person A", "Person B": "Person B"}
        
    df = add_owe_columns(df)

    person_a_paid = df.loc[df["payer"] == "Person A", "amount"].sum()
    person_b_paid = df.loc[df["payer"] == "Person B", "amount"].sum()
    person_a_share = df["person_a_owes"].sum()
    person_b_share = df["person_b_owes"].sum()

    a_name = user_names.get("Person A", "Person A")
    b_name = user_names.get("Person B", "Person B")

    fig = go.Figure(data=[
        go.Bar(
            name="Paid",
            x=[a_name, b_name],
            y=[person_a_paid, person_b_paid],
            marker_color=["#4C72B0", "#DD8452"],
        ),
        go.Bar(
            name="Share Owed",
            x=[a_name, b_name],
            y=[person_a_share, person_b_share],
            marker_color=["#4C72B080", "#DD845280"],
        ),
    ])
    fig.update_layout(
        barmode="group",
        title="Paid vs. Share per Person",
        yaxis_title="Amount (₹)",
    )
    return fig


def monthly_trend_chart(df: pd.DataFrame):
    """Bar chart of total spending per calendar month."""
    df = df.copy()
    df["month"] = pd.to_datetime(df["date"]).dt.to_period("M").astype(str)
    data = df.groupby("month")["amount"].sum().reset_index().sort_values("month")
    fig = px.bar(
        data,
        x="month",
        y="amount",
        title="Monthly Spending Trend",
        labels={"amount": "Total (₹)", "month": "Month"},
        color_discrete_sequence=["#4C72B0"],
    )
    fig.update_layout(xaxis_title="Month", yaxis_title="Total (₹)")
    return fig
