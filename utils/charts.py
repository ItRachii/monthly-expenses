import pandas as pd
import plotly.express as px

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

