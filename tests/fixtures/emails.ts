import type { IncomingEmail } from "../../src/lib/pipeline/types";

/**
 * Sanitised samples modelled on real alert formats (names, numbers and
 * addresses replaced). Keep the wording and table layout exactly as the
 * senders send them; parsers depend on it.
 */
const base = { labels: ["CATEGORY_UPDATES", "INBOX"], threadId: "t" };
const UOB_DISCLAIMER =
  "UOB EMAIL DISCLAIMER: Any person receiving this email and any attachment(s) contained, shall treat the information as confidential.";

export const uobPaynowIndividual: IncomingEmail = {
  ...base,
  messageId: "uob1",
  from: "unialerts@uobgroup.com",
  subject: "UOB Personal Internet Banking Notification Alerts",
  date: "2026-11-15T01:12:53Z",
  text: `You made a PayNow transfer of SGD 16.60 to ROYXX OX WEX YAXX (Mobile ending 7994) on your a/c ending 0856 at 9:12AM SGT, 15 Nov 26. If unauthorised, call UOB 24/7 Fraud Hotline.\n${UOB_DISCLAIMER}`,
};

export const uobPaynowBusiness: IncomingEmail = {
  ...base,
  messageId: "uob2",
  from: "unialerts@uobgroup.com",
  subject: "UOB Personal Internet Banking Notification Alerts",
  date: "2026-11-15T04:29:32Z",
  text: `You made a PayNow transfer of SGD 14.00 to Qashier-85 Jp Kr cui (UEN ending K7PI) on your a/c ending 0856 at 12:29PM SGT, 15 Nov 26. If unauthorised, call UOB 24/7 Fraud Hotline.\n${UOB_DISCLAIMER}`,
};

export const uobPaynowSuccess: IncomingEmail = {
  ...base,
  messageId: "uob3",
  from: "unialerts@uobgroup.com",
  subject: "UOB Personal Internet Banking Notification Alerts",
  date: "2026-11-15T04:46:51Z",
  text: `UOB - Your PayNow transfer to MRK WESTERN KITCHEN on 15-Nov-2026 is successful.\n${UOB_DISCLAIMER}`,
};

export const uobCard: IncomingEmail = {
  ...base,
  messageId: "uob4",
  from: "unialerts@uobgroup.com",
  subject: "UOB - Transaction Alert",
  date: "2026-11-03T10:51:19Z",
  text: `A transaction of SGD 4490.00 was made with your UOB Card ending 1234 on 03/11/26 at GAIN CITY-FUNAN MAIN. If unauthorised, call 24/7 Fraud Hotline now\n${UOB_DISCLAIMER}`,
};

export const uobReversal: IncomingEmail = {
  ...base,
  messageId: "uob5",
  from: "unialerts@uobgroup.com",
  subject: "Your transaction has been reversed",
  date: "2026-11-15T01:47:15Z",
  text: `A transaction of 10.60 SGD made with your UOB card ending 1234 on 15 Nov 26, 9:47AM at Grab* A-A34SFGPGXWAIAV has been reversed.\n${UOB_DISCLAIMER}`,
};

export const uobRefund: IncomingEmail = {
  ...base,
  messageId: "uob6",
  from: "unialerts@uobgroup.com",
  subject: "Your transaction has been refunded",
  date: "2026-11-12T03:20:41Z",
  text: `A refund of SGD49.70 from IKEA has been made to your UOB card ending 1234 on 08 Nov 2026. The refund will be posted in your next statement.\n${UOB_DISCLAIMER}`,
};

export const uobStatement: IncomingEmail = {
  ...base,
  messageId: "uob7",
  from: "unialerts@uobgroup.com",
  subject: "Your eStatement/eAdvice is ready for viewing",
  date: "2026-11-07T05:54:18Z",
  text: `Dear Customer, your One Account eStatement is ready for viewing. Log in to UOB TMRW or Personal Internet Banking to view it.\n${UOB_DISCLAIMER}`,
};

export const ocbcGooglePay: IncomingEmail = {
  ...base,
  messageId: "ocbc1",
  from: "Notifications@ocbc.com",
  subject: "Your funds transfer via Google Pay is successful",
  date: "2026-11-15T03:59:58Z",
  text: `Dear Valued Customer\n\nSGD13.50 was sent to TAX LEX HUXX using his/her mobile number (+XXXXXX1918) from the account you linked to Google Pay.\n\nHere are the details:\nDate of transfer: 15-Nov-2026\nTime of transfer: 11:59 AM SG Time\n\nIf you have any questions, please call our Personal Banking hotline.`,
};

export const tadaReceipt: IncomingEmail = {
  ...base,
  messageId: "tada1",
  from: "hailing@tada.global",
  subject: "[TADA] Receipt",
  date: "2026-11-15T04:13:23Z",
  text: `# Receipt Total Fee Charged\n*13.50 SGD*\n\n| Ride Fare | 11.50 SGD |\n| Platform Fee (incl. GST) | 1.10 SGD |\n| Fuel Support | 0.90 SGD |\n| | |\n\n------------------------------\n\n| Pick-up Date and Time | 15-11-2026 11:59 ~ 12:13 |\n| Ride Type | AnyTADA |\n| Driver's Name | DRIVER NAME |\n| Booking Code | 01a1dd55 |\n| Payment Method | Cash |\n`,
};

export const grabRide: IncomingEmail = {
  ...base,
  messageId: "grab1",
  from: "Grab <no-reply@grab.com>",
  subject: "Your Grab E-Receipt",
  date: "2026-11-11T00:30:43Z",
  text: ` Grab E-Receipt\n\n| |\n| Standard | Car or taxi | |\n\n| |\n| Hope you enjoyed your ride! Picked up on 11 November 2026 Booking ID: A-A2KCSPPWXBA7AV | |\n\n| |\n| Total Paid | S$21.40 |\n\nBreakdown\n\n| Fare | 19.30 |\n| Platform & partner fee | 1.20 |\n| Fuel Surcharge | 0.90 |\n\n| Total Paid | 21.40 |\n\n| Passenger Test User Profile PERSONAL | Paid by |\n| | 1234 | 21.40 |\n`,
};

export const grabPromo: IncomingEmail = {
  ...base,
  labels: ["CATEGORY_PROMOTIONS", "INBOX"],
  messageId: "grab2",
  from: "Grab Singapore <no-reply@grab.com>",
  subject: "Food you love, delivered in a few taps",
  date: "2026-11-15T07:31:29Z",
  text: "Enjoy all your favourites in one place, with prices that won't break the bank. Save S$5 today.",
};

export const shopeePayment: IncomingEmail = {
  ...base,
  messageId: "shopee1",
  from: "Shopee <info@mail.shopee.sg>",
  subject: "Your payment has been confirmed",
  date: "2026-11-14T04:42:24Z",
  text: `| Hi user, Your payment for order #2611149KT4UDMX has been confirmed. |\n| ORDER DETAILS |\n| Order ID: | #2611149KT4UDMX |\n| Order Date: | 14 Nov 2026 12:41:57 |\n| Seller: | uf_technology [](https://shopee.sg/x) |\n\n| 1. UFTECH UK 3 Pin Plug to C7 Power Cord | Figure 8 Cable |\n| Variation: | Side Angle 2m |\n| Quantity: | 1 |\n| Price: | S$10.90 |\n\n| Merchandise Subtotal: | S$10.90 |\n| Shipping Fee: | S$1.99 |\n| Total Payment: | S$12.89 |\n\n| PAYMENT DETAILS |\n| Payment Method: | SPayLater |\n| Payment Date: | 14 Nov 2026 12:42:21 |\n| Amount Paid: | S$12.89 |\n`,
};

export const shopeeDelivered: IncomingEmail = {
  ...base,
  messageId: "shopee2",
  from: "Shopee <info@mail.shopee.sg>",
  subject: "Your order #2611149KT4UDMX has been delivered",
  date: "2026-11-15T08:37:11Z",
  text: "We are pleased to inform you that #2611149KT4UDMX has been delivered. Once you confirm, payment will be made to the seller.",
};

export const stripeIdr: IncomingEmail = {
  ...base,
  messageId: "stripe1",
  from: "Grok xAI <receipts+acct_1Pk@stripe.com>",
  subject: "Your Grok xAI receipt [#1349-9139]",
  date: "2026-11-11T14:40:56Z",
  text: "Receipt from Grok xAI Receipt #1349-9139\nAmount paid\nRp294,500.00\n\nDate paid\nNovember 11, 2026 at 6:39:34 AM PST\n\nPayment method\n- 2998\n\nSummary\n\n- - Payment to Grok xAI : Rp294,500.00\n\n- Amount paid : Rp294,500.00\n",
};

export const simbaBill: IncomingEmail = {
  ...base,
  messageId: "simba1",
  from: "SIMBA Mobile <notifications@my.simba.sg>",
  subject: "Your SIMBA Invoice",
  date: "2026-11-10T03:02:54Z",
  text: ` Your SIMBA Invoice\n\n| |\n| 10-11-2026 Dear User, We have received your payment for the order below: |\n\n| Invoice Number: | ORDER#25352850 |\n| Order ID: | 25352850 |\n| Payment Date: | 10-11-2026 |\n| Amount Paid: | SGD 10 |\n`,
};

export const coinhakoBuy: IncomingEmail = {
  ...base,
  messageId: "coin1",
  from: "Coinhako <notifications@coinhako.com>",
  subject: "Your order to buy 0.00059814 BTC on November 15, 2026, 15:02 (UTC+8) is completed",
  date: "2026-11-15T07:06:01Z",
  text: `Dear USER,\n\n* You have successfully purchased 0.00059814 BTC *. View the order receipt below:\n\n| Order ID: | befc63c1 |\n| Date: | November 15, 2026, 15:02 (UTC+8) |\n\n| YOU PAID | |\n| Amount: | S$50 |\n| BTC/SGD Price: | S$83,174.35 |\n| Payment Method: | Coinhako Wallet |\n\n| YOU RECEIVED | |\n| Coinhako Fee: | S$0.25 |\n| Final Amount (Net): | BTC 0.00059814 |\n`,
};

export const newsletter: IncomingEmail = {
  ...base,
  messageId: "news1",
  from: "TLDR <dan@tldrnewsletter.com>",
  subject: "Gemini 4 Hydrogen, self-hosted agents",
  date: "2026-11-13T14:57:20Z",
  text: "Google introduced a fast model. Pricing starts at $2 per month for the subscription tier.",
};

export const unknownReceipt: IncomingEmail = {
  ...base,
  messageId: "unk1",
  from: "orders@somecafe.example",
  subject: "Your receipt from Some Cafe",
  date: "2026-11-13T05:00:00Z",
  text: "Thanks for your order! Total charged: S$8.40. Paid with Visa ending 1111.",
};

// Wise "Transfer sent" (names and amounts are made up)
const wiseBody = (headline: string, details: string) =>
  ` Wise. Your account for the world's money\n\n| |\n| Hello Alex, |\n\n| |\n| # ${headline} |\n\n| |\n| Your money got there in just 4 seconds. |\n| ## Transfer details |\n| ${details} |\n\n| View transfer details |\n| Thanks, |\n| The Wise team |`;

export const wiseToFoundation: IncomingEmail = {
  ...base,
  messageId: "wise1",
  from: "Wise <noreply@wise.com>",
  subject: "Transfer sent (#1111111111)",
  date: "2026-11-28T05:19:00Z",
  text: wiseBody("1,395,000 IDR is now in Yayasan Contoh Harapan's account.",
    "Amount: 99.30 SGD Rate: 1 SGD = 14,221.50 IDR Wise fee: 1.21 SGD Sent at: 13:19 (GMT+08:00) on 28 November 2026 Transfer Number: #1111111111"),
};

export const wiseToPerson: IncomingEmail = {
  ...wiseToFoundation,
  messageId: "wise2",
  subject: "Transfer sent (#2222222222)",
  text: wiseBody("300,000 IDR is now in Budi Santoso's account.",
    "Amount: 300,000 IDR Wise fee: 0 IDR Sent at: 17:17 (GMT+08:00) on 24 October 2026 Transfer Number: #2222222222"),
};

export const wiseToSelf: IncomingEmail = {
  ...wiseToFoundation,
  messageId: "wise3",
  subject: "Transfer sent (#3333333333)",
  text: wiseBody("9,057,500 IDR is now in your account.",
    "Amount: 639.54 SGD Rate: 1 SGD = 14,221.50 IDR Wise fee: 2.60 SGD Sent at: 12:52 (GMT+08:00) on 28 November 2026 Transfer Number: #3333333333"),
};

export const wisePaused: IncomingEmail = {
  ...wiseToFoundation,
  messageId: "wise4",
  subject: "Transfer of SGD to 200.0 SGD paused",
  text: "We've paused your transfer. Please verify.",
};

// Wise as Apps Script's getPlainBody delivers it: no markdown, heavy padding.
const pad = "\n  \n​\n".repeat(400);
export const wisePlain: IncomingEmail = {
  ...base,
  messageId: "wise5",
  from: "Wise <noreply@wise.com>",
  subject: "Transfer sent (#4444444444)",
  date: "2026-11-28T05:00:12Z",
  text: ` Wise. Your account for the world's money${pad}Hello Alex,\n50,000 IDR is now in Siti Rahma's account.\n\nYour money got there in just 3 seconds. Now that's what we call maximum\nease at full speed.${pad}Transfer details\nAmount: 4.47 SGD\nRate: 1 SGD = 14,221.50 IDR\nWise fee: 0.95 SGD\nSent at: 13:00 (GMT+08:00) on 28 November 2026\nTransfer Number: #4444444444\n${pad}Thanks,\nThe Wise team`,
};

export const wisePlainNoDetails: IncomingEmail = {
  ...wisePlain,
  messageId: "wise6",
  text: ` Wise.${pad}Hello Alex,\n50,000 IDR is now in Siti Rahma's account.${pad}Thanks,\nThe Wise team`,
};
