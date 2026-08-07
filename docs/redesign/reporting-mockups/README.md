# Reporting dashboard mockups (v1 IA review)

Interactive HTML mockups for the proposed v1 reporting IA. Open `index.html` in a browser (or via any static file server).

**Not a build epic yet.** Numbers on screen are layout placeholders. Metric *names* and grains are constrained to the current schema / existing pure libs.

## Screens (rev 2)

0. **Reporting Center index** — where the two new entries sit beside existing reports  
1. **Owner Network Health** — CEO / BD, active-org: **enrollment matrix** + this-month Approved/Submitted/Denied + median days; Share + CSV  
2. **Ops Pipeline** — tabs: **Provider Network · Workload · Turnaround** (CSV only). Holds Active network %, open cases, at-risk launches, standing denials, risk watch, fulfillment bars, provider coverage.

## Status honesty

Matrix cells use only Minted `case_status` labels plus **Active** (= live `enrollment_facts` OR `case_status = approved`).  
Not shown (not in schema): “Gathering docs”, spreadsheet “PTP”, free-text tentative notes as cell types.

## Locked product decisions (so far)

- Spec this session; build later (`22C` epic + metric dictionary)  
- Active org only for Network Health (`20A`)  
- Active = `groupPayerFulfillment` union (fact OR approved) (`16C`)  
- Legacy `/reports` → redirect into Reporting Center (`23A`)  
- No invented metrics; no sanctions/committee/SLA baselines  
- Live Supabase probes: **blocked in this cloud agent** even after desktop connect — need SQL results pasted or MCP tools visible to the run (`28C`)

## How to review

Click the screen chips at the top. On Ops Pipeline, switch the three underline tabs. React to information architecture first; pixel polish is deferred to the build session.
