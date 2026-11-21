import type { IncomingEmail } from "./types";
import { MONEY_RE, senderAddress } from "./text";

/** Senders whose emails are never spending (newsletters, marketing subdomains). */
const MARKETING_SENDER = /(^|[.@])(marketing|news|promo|campaigns?|e|em|email|mail-marketing)\.|newsletter|digest|substack\.com$|beehiiv\.com$|medium\.com$|linkedin\.com$/i;

const MONEY_WORDS =
  /\b(receipt|paid|payment|charged|purchase|purchased|order|invoice|transaction|transfer|debited|billed|subscription|renewal|refund)\b/i;

export type FilterResult = { pass: true } | { pass: false; reason: string };

/** Cheap rejection of emails that are clearly not transactions. */
export function prefilter(e: IncomingEmail): FilterResult {
  if (e.labels.includes("CATEGORY_PROMOTIONS")) return { pass: false, reason: "Gmail Promotions" };
  if (/^\s*<ADV>/i.test(e.subject)) return { pass: false, reason: "advertisement subject" };
  if (MARKETING_SENDER.test(senderAddress(e.from))) return { pass: false, reason: "marketing sender" };
  return { pass: true };
}

/** For unknown senders: does this look like it could be a transaction? */
export function looksTransactional(e: IncomingEmail): boolean {
  const text = `${e.subject}\n${e.text.slice(0, 6000)}`;
  return MONEY_RE.test(text) && MONEY_WORDS.test(text);
}
