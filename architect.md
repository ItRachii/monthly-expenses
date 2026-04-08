# Monthly Expense Tracker — Architecture

## Overview

A two-person shared expense tracking application built with Streamlit and SQLite. Users can log expenses, split them 50-50 or assign full ownership, and categorise each item for monthly analysis.

---

## Tech Stack

| Layer       | Technology          |
|-------------|---------------------|
| Frontend    | Streamlit           |
| Backend     | Python              |
| Database    | SQLite (via SQLAlchemy) |
| Charts      | Plotly / Altair     |

---

## Database Schema

### Table: `expenses`

| Column     | Type    | Description                                      |
|------------|---------|--------------------------------------------------|
| `id`       | INTEGER | Primary key, auto-increment                      |
| `date`     | DATE    | Date the expense occurred                        |
| `category` | TEXT    | Expense category (see categories below)          |
| `item`     | TEXT    | Description of the item or expense               |
| `amount`   | REAL    | Total amount in currency                         |
| `payer`    | TEXT    | Who paid — `Person A` or `Person B`              |
| `split`    | TEXT    | Split type — `50-50`, `Person A`, or `Person B` |

### Derived Fields (computed at query time)

| Field            | Formula                                         |
|------------------|-------------------------------------------------|
| `person_a_owes`  | If split=`50-50`: amount/2; if split=`Person B`: amount; else 0 |
| `person_b_owes`  | If split=`50-50`: amount/2; if split=`Person A`: amount; else 0 |
| `net_balance`    | What Person A owes Person B overall (or vice versa) |

---

## Expense Categories

```
Housing         — Rent, utilities, maintenance
Groceries       — Supermarket, fresh produce
Dining Out      — Restaurants, cafes, takeaway
Transport       — Fuel, public transit, parking, ride-share
Healthcare      — Pharmacy, doctor, gym
Entertainment   — Streaming, events, hobbies
Shopping        — Clothing, household items
Travel          — Flights, hotels, holiday expenses
Subscriptions   — Software, memberships
Other           — Anything that doesn't fit above
```

---

## Split Options

| Value      | Meaning                                      |
|------------|----------------------------------------------|
| `50-50`    | Each person pays half                        |
| `Person A` | Person A owes the full amount                |
| `Person B` | Person B owes the full amount                |

---

## Application Pages

### 1. Add Expense
- Form fields: Date, Category (dropdown), Item (text), Amount, Payer (radio), Split (radio)
- Submit button saves to the database
- Instant confirmation with a summary of what each person owes for that entry

### 2. Expense Log
- Filterable table: by month, category, payer, split type
- Inline edit and delete per row
- Export to CSV

### 3. Monthly Summary
- Total spent per month
- Breakdown by category (bar/pie chart)
- Per-person spend and owed amounts
- Running balance: who owes whom and how much

### 4. Settlement
- Shows the net balance between the two people
- Marks a month as "settled" once payment is made
- Settlement history log

---

## Project Structure

```
monthly-expenses/
├── app.py                  # Streamlit entry point, page routing
├── architect.md            # This file
├── db/
│   ├── __init__.py
│   ├── database.py         # SQLAlchemy engine, session setup
│   └── models.py           # Expense model / table definition
├── pages/
│   ├── add_expense.py      # Add Expense page
│   ├── expense_log.py      # Expense Log page
│   ├── monthly_summary.py  # Monthly Summary page
│   └── settlement.py       # Settlement page
├── utils/
│   ├── calculations.py     # Split logic, balance computations
│   └── charts.py           # Plotly/Altair chart helpers
├── requirements.txt
└── .streamlit/
    └── config.toml         # Theme and layout config
```

---

## Data Flow

```
User Input (Streamlit Form)
        |
        v
   Validation Layer
   (amount > 0, date valid, fields non-empty)
        |
        v
   calculations.py
   (compute person_a_owes, person_b_owes)
        |
        v
   SQLAlchemy ORM
        |
        v
   SQLite (expenses.db)
        |
        v
   Query & Aggregate
        |
        v
   Streamlit Display (tables, charts, balance)
```

---

## Key Business Rules

1. **Payer vs. Split are independent.** The payer field records who physically paid; the split field records how the cost is shared.
2. **Balance calculation** — at any point, the net balance is: `sum(person_b_owes) - sum(person_b_paid)`. Positive means Person B owes Person A; negative means Person A owes Person B.
3. **Settlement resets the running balance** for the selected month — it does not delete expense records.
4. **Months are calendar months** — filtering and summaries always align to `YYYY-MM`.

---

## requirements.txt (planned)

```
streamlit
sqlalchemy
pandas
plotly
```

---

## Future Considerations

- Multi-currency support with FX conversion
- Receipt image upload per expense
- Budget limits per category with alerts
- Export to PDF monthly report
- Authentication if hosted publicly
