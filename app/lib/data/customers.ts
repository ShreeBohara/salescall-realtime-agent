/**
 * Seed customer data for the voice copilot.
 *
 * These are fixtures that simulate a small CRM. The point is to give the
 * agent a grounded, non-hallucinatable context to answer rep questions
 * about ("what's the last objection from Acme?", "who's the champion at
 * Atmos?"). Four customers span a deliberately diverse set of deal stages
 * and scenarios so the demo can show meaningful variety.
 *
 * Shape mirrors what a real CRM would surface: contact, deal stage, MEDDIC
 * qualification, past objections, open tickets, and a tiny "past activity"
 * log. Not a full CRM — just enough for a believable live demo.
 */

export type DealStage =
  | "discovery"
  | "qualification"
  | "proposal"
  | "negotiation"
  | "closed-won"
  | "closed-lost";

export type Customer = {
  id: string;
  name: string;
  aliases: string[];
  industry: string;
  contact: {
    name: string;
    title: string;
    email: string;
  };
  dealStage: DealStage;
  dealSize: string;
  meddic: {
    metrics: string;
    economicBuyer: string;
    decisionCriteria: string;
    decisionProcess: string;
    identifiedPain: string;
    champion: string;
  };
  lastCallDate: string;
  pastObjections: string[];
  openTickets: number;
  recentActivity: string[];
  /**
   * A TIGHT 1–2 sentence narrative brief (~20–30 words) a BDR manager
   * would text a rep thirty seconds before the call: current state +
   * the single most important thing to close on this touch. Optimised
   * for scannability — the UI renders it as a large italic paragraph,
   * so anything over two sentences starts to feel like a wall. Details
   * (deal size, contact, objections, activity timeline) live in the
   * surrounding structured blocks; don't duplicate them here.
   */
  briefing: string;
};

export const CUSTOMERS: Customer[] = [
  {
    id: "acme-corp",
    name: "Acme Corp",
    aliases: ["acme", "acme corporation", "acme corp."],
    industry: "SaaS infrastructure",
    contact: {
      name: "Sarah Chen",
      title: "VP Engineering",
      email: "sarah.chen@acme.example",
    },
    dealStage: "negotiation",
    dealSize: "$120k ARR",
    meddic: {
      metrics: "Needs 30% reduction in incident response time; currently at 45 min MTTR",
      economicBuyer: "David Park, CFO — approves any spend over $100k",
      decisionCriteria: "SOC 2 Type II, SSO, >99.95% uptime SLA, 24/7 support",
      decisionProcess: "Security review (2 weeks) → CFO sign-off → procurement",
      identifiedPain: "Engineering team spending 12 hrs/week on manual incident triage",
      champion: "Sarah Chen (VP Eng) — has exec air cover",
    },
    lastCallDate: "2026-04-10",
    pastObjections: [
      "Pricing is higher than the incumbent vendor they're switching from",
      "Onboarding timeline of 3 months feels too long — wants 6 weeks",
    ],
    openTickets: 3,
    recentActivity: [
      "2026-04-10 — Discovery follow-up: Sarah confirmed CFO buy-in on business case",
      "2026-04-03 — Product demo to engineering team (8 attendees, positive feedback)",
      "2026-03-27 — Initial qualification call: identified MTTR as core metric",
    ],
    briefing:
      "Pricing and a 3-month onboarding are the holdouts before CFO sign-off — three open trial tickets are stalling momentum.",
  },
  {
    id: "atmos-industrial",
    name: "Atmos Industrial",
    aliases: ["atmos", "atmos inc", "atmos industries"],
    industry: "Industrial distribution",
    contact: {
      name: "Raj Patel",
      title: "Director of Operations",
      email: "rpatel@atmos.example",
    },
    dealStage: "qualification",
    dealSize: "$85k ARR",
    meddic: {
      metrics: "Looking to cut order-processing time by half (currently 48 hrs avg)",
      economicBuyer: "Unknown — Raj is the point of contact but authority unclear",
      decisionCriteria: "Integration with existing SAP ERP, multi-warehouse support",
      decisionProcess: "Unclear — Raj hasn't been able to tell us who else is in the loop",
      identifiedPain: "Manual order entry causing 8-10% error rate, downstream rework",
      champion: "Raj Patel — engaged, but may not have budget authority",
    },
    lastCallDate: "2026-04-08",
    pastObjections: [
      "Mentioned competitor (Globex) is offering 20% lower pricing",
      "Concerned about SAP integration complexity",
    ],
    openTickets: 0,
    recentActivity: [
      "2026-04-08 — Technical deep-dive on SAP connector (went well)",
      "2026-04-01 — Initial discovery call — surfaced Globex competitive pressure",
      "2026-03-22 — Inbound lead from LinkedIn ad campaign",
    ],
    briefing:
      "Raj is still the only stakeholder — surface the economic buyer before we propose. Globex is flashing 20% cheaper.",
  },
  {
    id: "globex-systems",
    name: "Globex Systems",
    aliases: ["globex", "globex corp"],
    industry: "Healthcare IT",
    contact: {
      name: "Dr. Maria Alvarez",
      title: "Chief Medical Information Officer",
      email: "m.alvarez@globex-health.example",
    },
    dealStage: "proposal",
    dealSize: "$240k ARR",
    meddic: {
      metrics: "HIPAA audit-readiness; reducing PHI incident review cycle from 14d to 3d",
      economicBuyer: "Board-level approval required for anything over $200k",
      decisionCriteria: "HIPAA BAA, HITRUST certified, on-prem deployment option",
      decisionProcess: "Clinical review → IT security → board vote (quarterly cadence)",
      identifiedPain: "Audit prep consuming 30% of CMIO's quarterly bandwidth",
      champion: "Dr. Alvarez enthusiastic but isolated — no second champion identified",
    },
    lastCallDate: "2026-04-02",
    pastObjections: [
      "On-prem deployment is a hard requirement — not yet clear if we can meet it",
      "Ghosting signal: two follow-ups unanswered over last 2 weeks",
    ],
    openTickets: 1,
    recentActivity: [
      "2026-04-02 — Proposal delivered; no response to two follow-ups since",
      "2026-03-18 — Security questionnaire completed and submitted",
      "2026-02-28 — CMIO introduced champion role; no second stakeholder yet",
    ],
    briefing:
      "Proposal out, two weeks of silence. Lock a second stakeholder or the board vote slips another quarter.",
  },
  {
    id: "initech-solutions",
    name: "Initech Solutions",
    aliases: ["initech", "initech inc"],
    industry: "Financial services",
    contact: {
      name: "Michael Bolton",
      title: "Head of Risk Analytics",
      email: "mbolton@initech.example",
    },
    dealStage: "closed-won",
    dealSize: "$180k ARR (renewing)",
    meddic: {
      metrics: "Originally: reduce risk-model retraining from weekly to daily — delivered",
      economicBuyer: "Peter Gibbons, VP Finance — signed off on expansion",
      decisionCriteria: "Proven ROI on year-1 contract; multi-seat expansion",
      decisionProcess: "Expansion conversation — renewal + 5 additional seats",
      identifiedPain: "Risk analytics team growing 3x in 2026 — needs more seats",
      champion: "Michael Bolton, internal champion since day one",
    },
    lastCallDate: "2026-04-12",
    pastObjections: [
      "None blocking — this is an expansion / renewal conversation",
    ],
    openTickets: 0,
    recentActivity: [
      "2026-04-12 — QBR: discussed 5-seat expansion for Q3",
      "2026-03-15 — Year-1 renewal signed",
      "2026-02-05 — Success metric review: risk-model retraining cadence met SLA",
    ],
    briefing:
      "Renewing with a 5-seat Q3 expansion — VP Finance already signed off. Lead with year-1 wins and close the seat count.",
  },
];

/**
 * Locate a customer by exact id, exact name (case-insensitive), alias, or
 * loose substring match in either direction. Returns null if no reasonable
 * match — the tool then surfaces this to the agent so it can ask the rep
 * to clarify instead of hallucinating a record.
 */
export function findCustomer(query: string): Customer | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  for (const c of CUSTOMERS) {
    if (c.id === needle) return c;
    if (c.name.toLowerCase() === needle) return c;
    if (c.aliases.some((a) => a.toLowerCase() === needle)) return c;
  }

  for (const c of CUSTOMERS) {
    const hay = c.name.toLowerCase();
    if (hay.includes(needle) || needle.includes(hay)) return c;
    if (c.aliases.some((a) => needle.includes(a.toLowerCase()))) return c;
  }

  return null;
}

export function getCustomerById(id: string): Customer | null {
  return CUSTOMERS.find((c) => c.id === id) ?? null;
}
