# Reporting dashboard mockups (v1 IA review)

Interactive HTML mockups for the proposed v1 reporting IA. Open `index.html` in a browser (or via any static file server).

**Not a build epic yet.** Numbers on screen are layout placeholders. Metric *names* and grains are constrained to the current schema / existing pure libs.

## Screens

0. **Reporting Center index** — where the two new entries sit beside existing reports  
1. **Owner Network Health** — CEO / BD, active-org, Share + CSV  
2. **Ops Pipeline** — tabs: Workload · Turnaround · Provider Network (CSV only)

## Locked product decisions (so far)

- Spec this session; build later (`22C` epic + metric dictionary)  
- Active org only for Network Health (`20A`)  
- Active = `groupPayerFulfillment` union (fact OR approved) (`16C`)  
- Legacy `/reports` → redirect into Reporting Center (`23A`)  
- No invented metrics; no sanctions/committee/SLA baselines  
- Live Supabase probes: **waiting** on desktop MCP auth (`24`)

## How to review

Click the screen chips at the top. On Ops Pipeline, switch the three underline tabs. React to information architecture first; pixel polish is deferred to the build session.
