import pandas as pd

CATEGORIES = [
    "Housing",
    "Groceries",
    "Dining Out",
    "Food",
    "Transport",
    "Healthcare",
    "Wellness",
    "Entertainment",
    "Shopping",
    "Travel",
    "Utilities",
    "Subscriptions",
    "Other",
]

SPLIT_OPTIONS = ["50-50", "Person A", "Person B"]
PEOPLE = ["Person A", "Person B"]


def compute_owes(amount: float, split: str) -> tuple:
    """
    Returns (person_a_owes, person_b_owes) — each person's share of the expense.

    This reflects financial responsibility, not who physically paid.
    - 50-50  → each owes half
    - Person A → Person A owes the full amount (Person B owes nothing)
    - Person B → Person B owes the full amount (Person A owes nothing)
    """
    if split == "50-50":
        return round(amount / 2, 2), round(amount / 2, 2)
    elif split == "Person A":
        return round(amount, 2), 0.0
    elif split == "Person B":
        return 0.0, round(amount, 2)
    return 0.0, 0.0


def add_owe_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Add person_a_owes and person_b_owes columns to an expenses DataFrame."""
    if df.empty:
        df["person_a_owes"] = []
        df["person_b_owes"] = []
        return df

    owes = df.apply(
        lambda row: pd.Series(
            compute_owes(row["amount"], row["split"]),
            index=["person_a_owes", "person_b_owes"],
        ),
        axis=1,
    )
    return pd.concat([df, owes], axis=1)


def compute_net_balance(df: pd.DataFrame) -> tuple:
    """
    Compute the net balance from an expenses DataFrame.

    Formula: balance = sum(person_b_owes) - sum(amounts paid by Person B)

    Returns:
        (balance, description)
        - balance > 0 → Person B owes Person A that amount
        - balance < 0 → Person A owes Person B that amount
        - balance == 0 → all square
    """
    if df.empty:
        return 0.0, "No expenses recorded."

    # .tolist() converts numpy/pandas scalars to native Python types,
    # keeping all arithmetic in pure Python and avoiding pandas __bool__ errors
    amounts = df["amount"].tolist()
    splits = df["split"].tolist()
    payers = df["payer"].tolist()

    total_b_owes: float = sum(compute_owes(a, s)[1] for a, s in zip(amounts, splits))
    total_b_paid: float = sum(a for a, p in zip(amounts, payers) if p == "Person B")

    balance = round(total_b_owes - total_b_paid, 2)

    if abs(balance) < 0.01:
        description = "All settled up!"
    elif balance > 0:
        description = f"Person B owes Person A ₹{balance:.2f}"
    else:
        description = f"Person A owes Person B ₹{abs(balance):.2f}"

    return balance, description

