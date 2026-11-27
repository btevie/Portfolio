export interface BillingTrapMatch {
  code: string;
  category: string;
  label: string;
  confidence: "high" | "medium";
  reason: string;
  action: string;
}

interface TrapRule {
  code: string;
  category: string;
  label: string;
  confidence: "high" | "medium";
  patterns: RegExp[];
  reason: string;
  action: string;
}

export const BILLING_TRAP_RULES: TrapRule[] = [
  {
    code: "ADDON_DEVICE_INS",
    category: "Optional Add-On",
    label: "Optional device / equipment insurance",
    confidence: "high",
    patterns: [/toestelverzekering/i, /device protection/i, /screen protection/i, /verlengde garantie/i, /extended warranty/i, /all-risk dekking/i],
    reason: "Device insurance is often bundled by default at checkout or upgrade and frequently duplicates home contents (inboedel) or business equipment insurance.",
    action: "Check whether you explicitly requested this cover; if not, cancel the add-on and ask for a pro-rata refund."
  },
  {
    code: "ADDON_PAPER_BILL",
    category: "Optional Add-On",
    label: "Paper invoice / payment surcharge",
    confidence: "high",
    patterns: [/papieren factuur/i, /factuurkosten/i, /paper statement/i, /acceptgiro/i, /administratiekosten factuur/i],
    reason: "Avoidable monthly surcharge for paper billing or non-direct-debit payments when free digital invoicing is available.",
    action: "Switch to digital portal billing and ask the vendor to waive recent paper-statement fees."
  },
  {
    code: "ADDON_SAAS_UPSELL",
    category: "Optional Add-On",
    label: "Unrequested AI / priority support / security add-on",
    confidence: "medium",
    patterns: [/ai add-on/i, /ai assistant/i, /copilot/i, /priority support/i, /premium sla/i, /beveiligingspakket/i, /veilig internet/i, /visual voicemail/i],
    reason: "Software add-ons, ISP security bundles, or priority support tiers are sometimes auto-enabled across seats after a free trial ends.",
    action: "Verify whether your team actively uses this add-on; downgrade unused seats and request a credit."
  },
  {
    code: "ADDON_WEEE_DISPOSAL",
    category: "EU Consumer / Retail Rule",
    label: "Appliance take-back / disposal fee",
    confidence: "high",
    patterns: [/oude apparaat retour/i, /afvoerkosten/i, /verwijderingsbijdrage/i, /disposal fee/i, /recycling fee/i],
    reason: "Under EU WEEE (AEEA) rules, retailers delivering a new appliance must take back the equivalent old appliance free of charge.",
    action: "Cite the EU WEEE 1-for-1 free take-back rule and request removal or refund of the disposal fee."
  },
  {
    code: "SUR_SHOP_SUPPLIES",
    category: "Vague Surcharge",
    label: "Unitemized shop supplies / consumables fee",
    confidence: "medium",
    patterns: [/klein materiaal/i, /shop supplies/i, /werkplaatsmateriaal/i, /consumables/i, /sundries/i],
    reason: "Flat or percentage 'shop supplies' fees are often added by garages and tradespeople without an itemized list of actual materials used.",
    action: "Ask for an itemized breakdown of actual materials used or request removal of the unsubstantiated flat fee."
  },
  {
    code: "SUR_FUEL_ENERGY",
    category: "Vague Surcharge",
    label: "Fuel / peak / remote-area courier surcharge",
    confidence: "medium",
    patterns: [/brandstoftoeslag/i, /fuel surcharge/i, /piektarief/i, /peak surcharge/i, /buitengebiedtoeslag/i, /remote area/i, /energietoeslag/i],
    reason: "Carrier surcharges are sometimes left active outside peak dates, above published weekly index tables, or on standard commercial addresses.",
    action: "Cross-check the surcharge against the carrier's published weekly index or postal zone table for the shipment date."
  },
  {
    code: "SUR_CUSTOMS_ADMIN",
    category: "Vague Surcharge",
    label: "Customs clearance / traffic fine admin markup",
    confidence: "medium",
    patterns: [/inklaringskosten/i, /advancement fee/i, /disbursement fee/i, /administratiekosten.*boete/i, /traffic fine admin/i],
    reason: "Carriers and leasing companies often add flat administrative markups that exceed contracted caps or standard postal rates.",
    action: "Check your carrier or lease agreement cap on administrative forwarding fees and dispute any excess."
  },
  {
    code: "DRIFT_PROMO_EXPIRED",
    category: "Contract Drift",
    label: "Expired welcome discount / variable rate rollover",
    confidence: "high",
    patterns: [/welkomstkorting/i, /actiekorting/i, /standaardtarief/i, /variabel tarief/i, /modelcontract/i, /out of contract/i],
    reason: "Introductory discounts or fixed contracts often roll onto significantly higher standard or variable rates automatically.",
    action: "Since your initial lock-in period has likely ended, contact the provider for a retention discount or switch plans."
  },
  {
    code: "DRIFT_POST_LEASE_RENTAL",
    category: "Contract Drift",
    label: "Ongoing hardware / terminal / modem rental",
    confidence: "medium",
    patterns: [/huur modem/i, /huur router/i, /settopbox/i, /huur betaalautomaat/i, /terminal rental/i, /meterhuur/i],
    reason: "Monthly equipment rental sometimes continues long after the hardware cost is paid off or duplicates statutory grid/meter fees.",
    action: "Check how long you have rented this hardware; request a buyout, free upgrade, or return unused equipment."
  },
  {
    code: "ZOMBIE_CARRIER_BILLING",
    category: "Third-Party Billing",
    label: "Third-party SMS / carrier billing charge",
    confidence: "high",
    patterns: [/diensten van derden/i, /betaalde sms/i, /carrier billing/i, /contentdiensten/i, /mobiel betalen/i],
    reason: "External subscriptions or accidental clicks are sometimes billed directly through your mobile phone invoice without a separate checkout.",
    action: "Block third-party carrier billing via Payinfo.nl immediately and dispute unauthorized charges."
  },
  {
    code: "ZOMBIE_OVERLAP",
    category: "Duplicate Coverage Check",
    label: "Potentially overlapping roadside / boiler / travel cover",
    confidence: "medium",
    patterns: [/wegenwacht/i, /pechhulp/i, /mobiliteitsgarantie/i, /onderhoudsabonnement.*ketel/i, /cv-ketel.*all-in/i],
    reason: "Roadside assistance often overlaps with dealer mobility guarantees, and all-in boiler contracts often overlap with 2–5 year manufacturer warranties.",
    action: "Check whether you already have dealer mobility cover or active manufacturer warranty before renewing."
  },
  {
    code: "MED_UNBUNDLED_HYGIENE",
    category: "Healthcare Tariff Check",
    label: "Separate hygiene / sterilization / admin surcharge",
    confidence: "high",
    patterns: [/hygi[eë]netoeslag/i, /sterilisatiekosten/i, /infectiepreventie/i, /administratiekosten zorg/i],
    reason: "Under Dutch NZa dental tariff rules, standard sterilization and hygiene costs are already built into treatment codes.",
    action: "Ask the provider to clarify the code against NZa tariff rules or remove the separate surcharge."
  },
  {
    code: "MED_INVALID_NOSHOW",
    category: "Healthcare Tariff Check",
    label: "Missed appointment / no-show fee",
    confidence: "medium",
    patterns: [/wegblijftarief/i, /niet nagekomen afspraak/i, /no-show/i],
    reason: "No-show fees are only valid if you missed an appointment without canceling within the clinic's stated notice window (typically 24–48 hours).",
    action: "If you canceled on time, forward your timestamped cancellation message and request a credit note."
  },
  {
    code: "ERR_PREMATURE_COLLECTION",
    category: "Collection Rule (WIK)",
    label: "Reminder / collection fee (check 14-day WIK notice)",
    confidence: "high",
    patterns: [/incassokosten/i, /aanmaningskosten/i, /buitengerechtelijke kosten/i, /herinneringskosten/i],
    reason: "Under Dutch WIK law, consumers must first receive a free 14-day payment reminder ('14-dagenbrief') before any collection fee can be charged.",
    action: "Verify whether you received a compliant 14-day free reminder letter; if not, pay only the principal amount."
  }
];

export function detectBillingTraps(description: string): BillingTrapMatch[] {
  const cleanDesc = description.trim();
  if (!cleanDesc) return [];
  return BILLING_TRAP_RULES.filter((rule) => rule.patterns.some((rx) => rx.test(cleanDesc))).map(
    ({ code, category, label, confidence, reason, action }) => ({
      code,
      category,
      label,
      confidence,
      reason,
      action,
    })
  );
}
