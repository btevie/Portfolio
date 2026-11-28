/**
 * Medical bills carry the highest cost of a mistake, so Overbill treats them with extra care: they are detected, marked,
 * always confirmed by the person, never counted as "clear to pay" automatically, and shown with a checklist.
 * Detection is only a hint (the person can switch it on or off); nothing here judges whether a charge is medically or legally correct.
 */

/** Words that on their own point to healthcare. */
const STRONG = /\b(hospitals?|clinics?|medical|surger(?:y|ies)|surgeons?|physicians?|doctors?|dr\.|dentists?|dental|orthodont\w*|pharmac(?:y|ies)|patients?|radiolog\w*|x-?ray|mri|ct scan|ultrasound|physio\w*|ambulance|anesth\w*|anaesth\w*|copay|co-pay|coinsurance|deductible|explanation of benefits|eob|cpt|icd-?\d*|drg|ziekenhuis\w*|huisarts\w*|tandarts\w*|apotheek\w*|zorgverzekeraar|eigen risico|dbc|krankenhaus\w*|zahnarzt\w*|arztpraxis\w*|apotheke|klinik\w*|h[ôo]pital|m[ée]decin|pharmacie|m[ée]dico|farmacia)\b/gi;
/** Words that suggest healthcare only together with something else. */
const WEAK = /\b(insurance|insurer|laborator\w*|lab|therap\w*|emergency|prescription|consultation|treatment|diagnos\w*|zorg|fysio|verzekering)\b/gi;

const count = (rx: RegExp, s: string) => new Set((s.match(rx) ?? []).map((m) => m.toLowerCase())).size;

export function looksMedical(vendorName: string, descriptions: string[]): boolean {
  const lines = descriptions.join(" \n ");
  if (count(STRONG, vendorName) > 0) return true;
  const strong = count(STRONG, lines);
  return strong >= 2 || (strong >= 1 && count(WEAK, `${vendorName} ${lines}`) >= 1);
}

export const MEDICAL_TITLE = "Medical bill: take extra care";
export const MEDICAL_INTRO = "Mistakes on medical bills are common and costly, and a clear result here does not mean the bill is right. Work through this before you pay:";

/** Things worth checking on the paper or portal copy. These are prompts, not findings. */
export const MEDICAL_CHECKLIST: string[] = [
  "Has your insurer processed this? Wait for their statement (an “explanation of benefits” or equivalent) before paying.",
  "Compare the amount asked of you with your insurer's statement: it should match what they say you owe.",
  "Ask for an itemised bill, with a line for every service, date and code. Check each one happened.",
  "Look for the same service billed twice, or on a date you weren't there.",
  "Check that insurance payments, adjustments and any discounts were subtracted.",
  "Check the patient name, the provider and the date of service.",
  "If anything is unclear, ask the provider's billing office in writing, and ask them to pause any collection until it is resolved.",
];

/** Added in front of the “verify on the original bill” steps of every finding on a medical bill. */
export const MEDICAL_VERIFY_FIRST = "This is a medical bill: confirm the amount against your insurer's statement before you act on this finding.";
