/** Merchant normalisation + keyword category rules. */

/** Stable key for merchant memory: "Qashier-85 Jp Kr cui" -> "85 jp kr cui", "Grab* A-A3..." -> "grab". */
export function merchantKey(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/^(qashier|sumup|fomo pay|fomopay|nets|paynow)[-\s]+/i, "");
  s = s.replace(/\*.*$/, ""); // "grab* a-xxxx" -> "grab"
  s = s.replace(/\b(pte\.?\s*ltd\.?|private limi\w*|sing(apore)?)\b/g, "");
  s = s.replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  return s || raw.toLowerCase().trim();
}

/** Friendly display name. */
export function displayMerchant(raw: string): string {
  const s = raw.replace(/^Qashier-/i, "").replace(/\s+/g, " ").trim();
  return s.length > 60 ? s.slice(0, 60) : s;
}

const RULES: Array<[RegExp, string]> = [
  [/coinhako|crypto|btc/, "Invest"],
  [/\b(grab \(ride\)|tada|gojek|comfort|cdg|zig|taxi|ez ?link|simplygo|transitlink|mrt)\b/, "Transport"],
  [/\b(fairprice|ntuc|sheng siong|cold storage|giant|don don donki|redmart|prime supermarket|hao mart)\b/, "Groceries"],
  [/\b(kitchen|cafe|caf|coffee|kopi|restaurant|food|eat|eating|bistro|bakery|bak kut|chicken rice|noodle|western|thai|japanese|korean|ramen|sushi|hawker|canteen|dining|toast|mcdonald|kfc|subway|starbucks|grabfood|foodpanda|deliveroo|baan ?thai|jp kr)\b/, "Food"],
  [/\b(simba|singtel|starhub|m1|circles|sp services|sp group|town council|insurance)\b/, "Bills"],
  [/\b(netflix|spotify|youtube|disney|apple com|icloud|google one|grok|xai|x subscription|openai|chatgpt|anthropic|claude|notion|adobe|microsoft)\b/, "Subscription"],
  [/\b(guardian|watsons|clinic|pharmacy|polyclinic|dental|medical|hospital|unity)\b/, "Health"],
  [/\b(furnish\w*|furniture|ikea|metal fabri\w*|hardware|renovation|aircon|plumb\w*)\b/, "House"],
  [/\b(uniqlo|h&m|zara|cotton on|tommy|north face|nike|adidas)\b/, "Clothes"],
  [/\b(shopee|lazada|amazon|aliexpress|taobao|qoo10|gain city|courts|harvey norman|best denki|challenger|ishopchangi)\b/, "Shopping"],
  [/\b(airline|airasia|scoot|singapore airlines|hotel|marriott|hilton|agoda|booking com|klook|trip com)\b/, "Travel"],
  [/\b(cinema|golden village|shaw|cathay|steam|playstation|nintendo)\b/, "Entertainment"],
];

export function keywordCategory(merchantRaw: string, hint?: string): string | null {
  if (hint) return hint;
  const key = merchantKey(merchantRaw);
  for (const [re, cat] of RULES) if (re.test(key)) return cat;
  return null;
}
