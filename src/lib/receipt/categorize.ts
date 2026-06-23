// Maps a free-text item description to one of the app's standard categories via
// keyword matching. Deliberately conservative — anything unrecognized falls back
// to "Other", and the user can change it in the review screen.

const RULES: { category: string; keywords: string[] }[] = [
  {
    category: "Groceries",
    keywords: [
      "milk", "bread", "egg", "rice", "atta", "flour", "dal", "pulse", "sugar",
      "salt", "oil", "ghee", "butter", "cheese", "paneer", "curd", "yogurt",
      "vegetable", "veg", "fruit", "onion", "potato", "tomato", "banana",
      "apple", "biscuit", "maggi", "noodle", "snack", "grocery", "kirana",
      "masala", "spice", "tea", "coffee bean", "flak", "cereal", "juice",
      "water bottle", "soft drink", "chocolate", "chips",
    ],
  },
  {
    category: "Dining Out",
    keywords: [
      "restaurant", "cafe", "coffee", "pizza", "burger", "biryani", "thali",
      "meal", "lunch", "dinner", "breakfast", "dosa", "samosa", "swiggy",
      "zomato", "food court", "dine", "beverage", "latte", "cappuccino",
    ],
  },
  {
    category: "Transport",
    keywords: [
      "uber", "ola", "rapido", "auto", "taxi", "cab", "fuel", "petrol",
      "diesel", "metro", "bus", "fare", "parking", "toll", "fastag",
    ],
  },
  {
    category: "Healthcare",
    keywords: [
      "pharma", "medicine", "tablet", "capsule", "syrup", "doctor", "clinic",
      "hospital", "lab", "diagnostic", "dental", "apollo", "pharmacy", "med ",
    ],
  },
  {
    category: "Entertainment",
    keywords: [
      "movie", "cinema", "pvr", "inox", "ticket", "game", "concert", "event",
      "bookmyshow", "popcorn",
    ],
  },
  {
    category: "Shopping",
    keywords: [
      "shirt", "tshirt", "t-shirt", "jeans", "trouser", "dress", "apparel",
      "clothing", "footwear", "shoe", "sandal", "watch", "bag", "cosmetic",
      "electronic", "charger", "cable", "headphone", "myntra", "ajio",
    ],
  },
  {
    category: "Utilities",
    keywords: [
      "electricity", "water bill", "gas", "lpg", "broadband", "wifi",
      "internet", "recharge", "postpaid", "prepaid", "dth", "bill payment",
    ],
  },
  {
    category: "Subscriptions",
    keywords: [
      "netflix", "spotify", "prime", "hotstar", "youtube", "subscription",
      "membership", "saas", "plan renewal",
    ],
  },
  {
    category: "Travel",
    keywords: [
      "hotel", "flight", "airline", "indigo", "train", "irctc", "booking",
      "resort", "lodge", "stay", "trip",
    ],
  },
  {
    category: "Wellness",
    keywords: [
      "soap", "shampoo", "toothpaste", "sanitizer", "gym", "salon", "spa",
      "skincare", "lotion", "deodorant", "grooming",
    ],
  },
  {
    category: "Housing",
    keywords: ["rent", "maintenance", "society", "deposit", "furniture"],
  },
];

/** Returns the best-guess category for an item description (default "Other"). */
export function categorize(description: string): string {
  const text = ` ${description.toLowerCase()} `;
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) return rule.category;
    }
  }
  return "Other";
}
