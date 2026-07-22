/**
 * Heya team directory (July 2026), from the internal directory doc. Used by the
 * one-click import in Settings to seed/refresh people profiles. Dean himself
 * (the owner) is intentionally omitted. All are Heya.
 */
export interface DirectoryEntry {
  fullName: string;
  role: string;
  email: string;
  notes: string;
}

export const HEYA_DIRECTORY: DirectoryEntry[] = [
  {
    fullName: "Yehuda Lazarus",
    role: "Chief Executive Officer",
    email: "ylazarus@heya.team",
    notes:
      "CEO of Heya and anchor of strategic direction; close involvement in client relationships, key personnel decisions, and operational escalations. Direct and concise, often replies briefly from mobile. Recent: LEA timesheet investigation oversight, client-level LEA billing/hours reconciliation, staffing (A1 Equipment departure, ALEF contract). Away periodically and delegates actively to Dean.",
  },
  {
    fullName: "Debbie Derman",
    role: "Finance Manager",
    email: "dderman@heya.team",
    notes:
      "Runs Heya's finance operations hands-on: billing, debtor/creditor recon, invoicing, payroll inputs, expenses. Maintains the LEA billing & overtime spreadsheets, processes client invoices (Economeds, Matan), captures expenses on Hubdoc in Xero. Thorough; flags discrepancies proactively (added unpaid-leave column to the LEA tracker). Distributed the EOD reporting cheat sheet. Coordinates closely with Dean and Yehuda.",
  },
  {
    fullName: "Stephen Kandorozu",
    role: "IT Manager",
    email: "skandorozu@heya.team",
    notes:
      "Goes by Steph. Leads all IT: user support, equipment, licensing, network stability, client-facing system admin. Ran a structured KRISP noise-cancellation trial for DLP Funding and produced a recommendation report. Coordinated account deactivation and peripheral collection on A1 Equipment's exit. Methodical; escalates clearly to Dean on strategic IT and to Debbie on asset registers.",
  },
  // Lisa Wainbergas (former Executive Assistant) removed at Dean's request —
  // no longer his PA. Kept out of the seed so a re-import won't restore her.
  {
    fullName: "Aidan Le Fleur",
    role: "Administration & Recruitment Coordinator",
    email: "afleur@heya.team",
    notes:
      "Straddles admin and recruitment across client rooms and campaigns. Conducts interviews, screens/pipelines applicants, covers for absent account managers. Led the Spanish-speaking CSR interview programme (all five initial sessions), managed ALEF interview setups, Economeds interview coordination. Structured, client-specific daily reporting to Dean.",
  },
  {
    fullName: "Jesse Figueiredo",
    role: "HR Generalist",
    email: "jfigueiredo@heya.team",
    notes:
      "Day-to-day HR: employment contracts, disciplinary documentation, onboarding admin, staff lifecycle. Prepares contracts and fixed-term agreements for Dean's approval, manages salary confirmations with Mo, drafts termination letters with payout calcs. Process-driven; flags uncertainty on dates/figures for review. Shared the office floor plan with Dean.",
  },
  {
    fullName: "Khomotso Manaka",
    role: "Head of Recruitment & HR",
    email: "kmanaka@heya.team",
    notes:
      "Goes by Mo. Leads recruitment and HR: full pipeline, client-facing recruitment comms, disciplinary proceedings, terminations, staff welfare. Provided a formal Spanish-speaking CSR update to Molly and Kimberly at Anchor. Manages conduct issues and liaises with IT on access deprovisioning. Sought Dean's guidance on a sponsorship request letter; manages Uber reconciliation for staff transport.",
  },
  {
    fullName: "Tiago Figueiredo",
    role: "Software Developer",
    email: "tfigueiredo@heya.team",
    notes:
      "In-house developer: data systems, reporting tools, integrations. Led the LEA timesheet investigation with Zozo — compared 64 disputed records against Zoho Creator and Zoho People, produced a detailed analysis for leadership and LEA. Researching Paylocity-Zoho integration at Yehuda's request. Structured updates with quantified breakdowns; works closely with account management.",
  },
  {
    fullName: "Zozo Nyokani",
    role: "Account Manager",
    email: "znyokani@heya.team",
    notes:
      "Manages client accounts; primary operational interface with client contacts. Worked with Tiago on the LEA hours comparison (64 flagged records) and communicated findings to the client. Manages Zoho Creator and Zoho People reporting, shares reports with Dean. Strong team orientation and accountability.",
  },
];
