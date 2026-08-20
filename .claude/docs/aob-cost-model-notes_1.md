# AoBPlatform Cash Model — Notes
### Companion to `AoBPlatform-Cash-Model.xlsx` · 19 August 2026

---

## 1. What this model is, and is not

**It is** arithmetic on a set of assumptions, built so that every assumption sits in a labelled cell and every number below it is a formula. Change an input, the whole thing recalculates.

**It is not a forecast.** No practice has paid anything. The adoption rate — the single largest driver — is a guess. Treat the model as a way of testing whether a shape of business can work, not as a prediction that it will.

**The most useful thing in it is not the answer. It is the ranking of what changes the answer** (§5).

---

## 2. Structure

| Tab | What it holds |
|---|---|
| **Assumptions** | Every input. Blue = you can change it. Yellow = it moves the answer most. Grey = driven by the scenario switch. |
| **Model** | The five-year build: installed base → revenue → cost of delivery → gross profit → operating costs → EBITDA → D&A → tax → **net profit after tax** → cash → capital to raise. |
| **Scenarios** | Four cases side by side with full P&L, the break-even table, and the Australian ceiling. |
| **Unit Economics** | One average GP practice: revenue, gross profit, acquisition cost, payback, lifetime value. |
| **Sensitivity** | The levers in plain language, plus the model's known weaknesses. |

**The scenario switch is cell B4 on the Assumptions tab.** Change it to 1, 2, 3 or 4 and the Model tab follows. The scenario table sits at row 52 — edit the blue numbers there to test something outside the four cases.

| B4 | Scenario | First profitable year | FY31 NPAT | Capital to raise |
|---|---|---|---|---|
| 1 | Base | Never | ($7.45m) | $25.00m |
| 2 | Lean team | Never | ($1.27m) | $12.12m |
| 3 | Lean + more adoption | FY31 | $0.91m | $8.39m |
| 4 | Realistic upside | **FY30** | **$3.16m** | **$6.47m** |

---

## 3. Where the assumptions came from

### Sourced — reasonably firm

| Input | Value | Source |
|---|---|---|
| GP practices in Australia | 7,132 | RACGP Health of the Nation 2025 |
| GPs in Australia | 40,375 (5.0 per practice used) | RACGP 2025 |
| Reference price — Bp Premier | ~$124/month per full-time doctor | Best Practice published pricing |
| Reference price — HotDoc | from ~$85/month per practitioner | HotDoc support |
| Reference price — AutoMed AoB utility | $125 + GST once-off per location | AutoMed |
| SMS cost | ~4c | Bp Comms |
| Modelled practice saving | $4,000–5,000 per FTE GP year one, ~$1,750/yr after | Health & Life advisory estimate |
| Company tax rate | 25% base rate entity | ATO threshold, turnover under $50m |

### Assumed — no evidential basis

| Input | Value | Confidence |
|---|---|---|
| **New practices won each year** | 60 → 1,100 GP | **Lowest. This is the model's weakest point.** |
| Non-GP target practices | 12,000 | Low — no published practice count exists for these segments |
| Annual churn | 5% → 10% | Low — real churn is front-loaded in year one, this is flat |
| Managed follow-up attach rate | 55% | Low |
| Managed follow-up delivery cost | 45% of that revenue | **Low, and it matters — see §6** |
| Enduring agreements per practice | 1,500 | Low |
| Headcount plan | 8 → 36 FTE | Medium — it is a choice, not a forecast |
| Messaging and infrastructure | $3.50 per practitioner per month | Medium |

---

## 4. What to look at first

Read the tabs in this order, and stop at the first one that fails:

1. **Scenarios → the ceiling block.** 100% of the Australian market is **$37.6m ARR** at base pricing, **$51.7m** at upside pricing. If that ceiling is too low to be interesting, nothing else matters.
2. **Scenarios → break-even table.** At 30 FTE you need **32% of every GP practice in Australia** to break even. At 50 FTE, 53%. Ask whether that share is achievable against incumbents who bundle a form at zero marginal cost.
3. **Model → NET PROFIT AFTER TAX row.** Is there a year it turns positive, and how far away is it?
4. **Model → capital to raise.** Can that be raised on these numbers?
5. **Unit Economics → months to recover acquisition cost.** Around 7 months is healthy. Ignore the lifetime-value ratio (§7).

---

## 5. What actually tweaks the bottom line

Measured against scenario 4. Each row changes **one** input and holds everything else.

| Lever | Change tested | FY31 EBITDA | Peak cash | Profitable from |
|---|---|---|---|---|
| **Adoption** | +25% practices won | **+$2.51m** | +$0.90m | FY30 |
| **Adoption** | −25% practices won | **−$2.50m** | −$2.18m | **slips to FY31** |
| **Headcount** | 44 FTE by FY31 not 36 | −$1.43m | −$1.64m | **slips to FY31** |
| **Price** | $59 per practitioner not $49 | +$1.08m | +$0.41m | FY30 |
| **Price** | $39 per practitioner not $49 | −$1.08m | −$0.69m | FY30 |
| **Headcount** | 30 FTE by FY31 not 36 | +$1.07m | — | FY30 |
| Practice size | 6.0 practitioners per practice not 5.0 | +$0.97m | +$0.37m | FY30 |
| Practice size | 4.0 practitioners per practice not 5.0 | −$0.97m | −$0.58m | FY30 |
| Enrolment price | $3 per agreement not $2 | +$0.87m | +$0.29m | FY30 |
| Churn | 5% not 10% | +$0.85m | +$0.14m | FY30 |
| **Follow-up delivery cost** | 60% not 45% | **−$0.83m** | −$0.45m | FY30 |
| **Follow-up delivery cost** | 30% not 45% | **+$0.83m** | +$0.32m | FY30 |
| Churn | 15% not 10% | −$0.77m | −$0.08m | FY30 |
| Sales and marketing | 4 points lower | +$0.65m | +$0.05m | FY30 |
| Follow-up attach | 70% not 55% | +$0.62m | +$0.23m | FY30 |
| Follow-up attach | 40% not 55% | −$0.62m | −$0.26m | FY30 |
| Messaging | $2.00 not $3.50 | +$0.26m | +$0.09m | FY30 |

### Reading that table

**Adoption is worth more than everything else combined, and it is the least controllable.** A quarter more or less than assumed swings FY31 EBITDA by ±$2.5m and moves profitability by a year. No pricing or cost decision comes close. **This is why fifteen conversations with practice managers beat another pass on the spreadsheet.**

**Headcount is the largest lever you actually control.** Eight extra people by FY31 costs $1.43m of EBITDA and pushes profitability out a year. Eight fewer saves $1.07m. Nothing else on the list is as directly in your hands.

**Price matters less than it feels like it should.** ±$10 per practitioner per month is worth about ±$1.08m — real, but a third of the adoption swing. And you are already capturing ~65% of the modelled saving at $49, so the headroom above that is thin.

**Practice size is a targeting decision disguised as an assumption.** Selling to 6-practitioner practices instead of 4-practitioner ones is worth **$1.94m of swing** at the same practice count and the same sales effort. Qualify on size.

**Messaging and infrastructure is noise.** $0.26m. Worth engineering properly; not worth optimising for cost.

---

## 6. The one number to measure first

**Managed follow-up delivery cost.** Assumed at 45% of that revenue, and the range 30–60% swings FY31 EBITDA by **$1.66m** — comparable to eight staff.

It is also the assumption most likely to be wrong, because it depends entirely on how much of the outbound contact AI genuinely resolves. And the scoping rule in Requirements §13 should push it down: calls happen **only** where an unsigned episodic agreement is blocking a claim, never for post-claim notices.

Rough sizing for a 5-GP practice: ~1,320 bulk-billed encounters a month, 85% captured in-practice, ~200 remote, 80–85% of those resolving on SMS or email — leaving **30–40 a month that reach a call**, ~20 resolved by AI, ~14 escalated to a human at 2–3 calls each. That is roughly 2.5 hours of human time and **$120–150 of cost against $400 of revenue: 30–37%**.

**Hold the model at 45% until it is measured.** If it lands at 32%, that is roughly $450k a year of FY31 EBITDA that is not in the plan.

---

## 7. Known weaknesses

- **Adoption is asserted, not tested.** 4,493 practices by FY31 is ~24% of the assumed 19,000-practice universe, in five years, against incumbents bundling a form for free.
- **Churn is a flat annual rate.** Real churn is front-loaded in year one and this understates early losses.
- **Lifetime value to acquisition cost reads ~16x. Do not use it.** It falls out of a 10% churn rate implying a ten-year customer life. Anything above ~5x means churn or acquisition cost is too kind. Payback in months is the honest metric.
- **Enrolment campaign revenue is one-off** and does not repeat. It flatters FY28 and FY29. Strip it out when judging progress.
- **Non-GP practice count of 12,000 is an estimate.** No published figure exists for those segments.
- **Development is expensed, not capitalised.** That depresses EBITDA relative to peers who capitalise. Deliberate — capitalising would flatter the number by moving real cost below the line.
- **No allowance for a failed security review, a lost integration, or a regulatory reversal.** All three have precedent in this market; the last one cost one vendor about $1m.
- **Tax losses are assumed to survive.** They carry forward indefinitely subject to continuity of ownership or the same business test — **a change of control on a funding round can forfeit them.** At FY31 that is roughly $1.45m of value. Check with a tax adviser before raising.

---

## 8. Operating disciplines that fall out of the model

1. **Every FTE above ~35 needs roughly $500k of revenue behind it.** Put it in the operating plan as a rule, not an aspiration.
2. **Never price per agreement.** Enduring agreements and 6-month plan agreements cut agreement volume by design — succeeding at the customer's problem would cut your own revenue. Price per practitioner.
3. **Qualify on practice size.** A 6-practitioner practice is worth 50% more than a 4-practitioner one for the same sales effort.
4. **Raise against the lean plan.** $6.5–8.5m, not $25m. The base case's $25m is an artefact of a headcount guess, and the losses compound if you fund it.
5. **Strip one-off enrolment revenue out of every progress report.**
6. **Instrument the design partner before committing any return figure to writing.** Capture rate by channel, resolution rate by attempt number, and the follow-up delivery cost.

---

## 9. The ceiling, restated

| | Base pricing | Upside pricing |
|---|---|---|
| Recurring revenue per GP practice per year | $3,885 | $5,655 |
| 100% of the Australian market | **$37.6m ARR** | **$51.7m ARR** |
| A strong 25% share | $9.4m ARR | $12.9m ARR |

Extending scenario 4 to FY33 gives $27.8m of revenue — about **54% of the entire Australian market**. That is the point at which the model stops being a plan and becomes a hope.

**So the real strategic question is not in this spreadsheet.** It is whether ARPU can be lifted through the broader consent-and-compliance record, or whether the reconciliation product — which is priced against *money found* rather than *labour saved*, and so is not capped by the customer's own saving — can carry a materially higher price. That is the only lever identified so far that escapes the ceiling, and it is unsized until the design partner is instrumented.

---

## 10. When does the business become cash-positive?

Two different questions hide inside that, and the answer depends on which — and on which scenario.

| Scenario | Stops burning cash | Repays the whole burn | Deepest hole |
|---|---|---|---|
| 1 · Base | **Never** | Never | ($46.6m) at FY34, still falling |
| 2 · Lean team | FY33 | Not within 8 years | ($11.5m) at end FY32 |
| 3 · Lean + more adoption | FY31 | FY33 | ($7.6m) at end FY30 |
| 4 · **Realistic upside** | **FY30** | **FY32** | **($5.7m) at end FY29** |

**Scenario 4 in detail:**

| | FY27 | FY28 | FY29 | FY30 | FY31 | FY32 |
|---|---|---|---|---|---|---|
| Revenue | $0.17m | $1.35m | $4.78m | $10.30m | $16.21m | $22.10m |
| Net cash flow | (1.53) | (2.40) | (1.79) | **+0.36** | +2.92 | +4.56 |
| Closing cash | (1.53) | (3.93) | **(5.72)** | (5.36) | (2.43) | **+2.13** |

**FY30 is the milestone that matters** — the first year the business funds itself. It is marginal, +$0.36m on $10.3m of revenue, so the crossover falls mid-year rather than on day one. The model is annual and cannot pin the month. **FY32 is when the investors are whole.**

Two things worth reading off that table beyond the dates:

**Scenario 1 does not just take longer — it never converges.** Revenue reaches $15m by FY33 and EBITDA is still stuck near −$7.2m, because headcount grows in step with the base. That is not a business that needs more patience. It is a business with the wrong cost structure, and more funding makes the hole deeper rather than shorter.

**Scenario 2 shows the trap of getting half the fix right.** Lean team, but base pricing and base adoption: it stops burning in FY33 and never repays inside eight years. Fixing headcount alone buys survival, not a return. The cost discipline and the growth are both required.

---

## 11. What if we hire two senior specialists at $250,000 each?

The model uses an **average** fully loaded cost of $150,000 rising 3% a year. That average already assumes a mix — some senior, some not. Naming two people at $250,000 means carrying a **$100,000 premium each** above that average.

| | FY31 EBITDA | Cash trough | Cash-flow positive |
|---|---|---|---|
| Scenario 4 as modelled | $3.28m | ($5.72m) | FY30 |
| **+ 2 specialists at $250k** | **$3.06m** | **($6.32m)** | FY30 |
| Difference | −$0.22m | **−$0.60m** | unchanged |

**It is affordable, and the number that matters is the cash trough, not the profit.** The FY31 profit effect is small — $220k. But the premium is paid every year from FY27, when there is no revenue to absorb it, so it deepens the hole by **$600k** and adds that much to the raise.

**The honest framing:** two people at $250,000 is $500,000 a year. In FY27 that is roughly a third of the entire cost base. Whether it is worth it turns on one question — do those two hires shorten the path to the first fifty paying practices? If yes, the $600k is trivially recovered, because adoption is worth ±$2.5m and they are the lever that produces it. If they are hired because the work is technically interesting rather than because it accelerates customers, it is $600k of runway spent on nothing that moves the ranking in §5.

**Note the shape of the team this implies.** Eight FTE in FY27, two of them at $250k, means those two are a quarter of the headcount and a third of the payroll. That is a defensible structure for a compliance product where a mistake is a criminal offence and the integration is the whole moat — but it should be a deliberate choice, recorded as one.

---

## 12. Is hosting included? Yes — and it is understated in the early years

**Yes.** The line is **"Messaging and infrastructure"** on the Model tab, set at **$3.50 per practitioner per month** on the Assumptions tab. It is intended to cover SMS at around 4c, email, cloud hosting, storage, and the encryption and key-management services.

**But it is a purely variable line, and that is wrong for the first two years.**

At 57 practices in FY27 the model charges roughly **$14,000 for the year**. Real infrastructure for this product does not cost $14,000. Australian data residency, an HSM or managed key service, encrypted storage with per-practice key separation, an append-only log store with object lock, external timestamp anchoring, monitoring, staging and test environments, and a tier-one messaging gateway carry a **fixed floor** whether you have five practices or five hundred.

**A realistic floor is $80,000–$120,000 a year from day one**, falling as a percentage of revenue but never to zero.

| | FY31 EBITDA | Cash trough |
|---|---|---|
| Scenario 4 as modelled | $3.28m | ($5.72m) |
| **+ $90k a year infrastructure floor** | **$3.19m** | **($5.98m)** |
| **+ floor and two specialists** | **$2.97m** | **($6.58m)** |

**So both corrections together cost about $860k of cash trough and $310k of FY31 profit.** Neither changes the date the business turns cash-positive. Both should go into the model rather than being discovered in year two.

**What is genuinely not in the model, and should be sized before the raise:**

- **IRAP assessment** if the product is cloud-hosted and ever integrates with Services Australia — five figures, vendor-funded, and explicitly not the agency's responsibility
- **Penetration testing** after major releases — mandatory under the third-party security policy
- Security code review, and reaching Essential Eight maturity level three
- Professional indemnity and cyber insurance
- Legal — the s 65C conformance position, practice contracts, the breach protocol
- NAATI translation of the agreement template, once per language

These sit in the **"Security, compliance and assurance"** line at $140k–$300k a year, which is a placeholder rather than a costed plan. It is roughly the right order of magnitude and should be replaced with quotes.

---

## 13. If we raise the money, what do investors want in return?

### 13.1 The mechanics

Equity investment is priced off a **pre-money valuation**. You agree what the business is worth before the money goes in; the investment is added; the investor's share is their money divided by the post-money total.

```
  pre-money valuation  +  investment  =  post-money valuation
  investor's share     =  investment / post-money
```

On a **$6.5m raise**:

| Pre-money | Post-money | Investor takes | Founders retain |
|---|---|---|---|
| $10m | $16.5m | **39%** | 61% |
| $15m | $21.5m | **30%** | 70% |
| $20m | $26.5m | **25%** | 75% |
| $26m | $32.5m | **20%** | 80% |

Add an employee option pool — typically 10–15%, and usually carved out of the **pre-money**, meaning founders bear it — and expect real founder dilution of roughly **35–45%** at this raise size.

Investors will also expect a **liquidation preference** (usually 1x non-participating: they get their money back first, or convert to equity, whichever is better), **pro-rata rights** to maintain their percentage in later rounds, board representation, and a set of protective provisions over major decisions.

### 13.2 What return they are underwriting to

This is the part worth being clear-eyed about.

A venture fund is not underwriting *your* return. It is underwriting its **fund's** return. A typical early-stage fund expects most investments to fail and needs the survivors to return the entire fund. That means the individual investment must be capable of **10x or more in seven to ten years** — not likely to, but *capable* of.

**Test this business against that hurdle.**

Extending scenario 4 to FY33 gives **$27.8m of revenue** and roughly $8.7m of EBITDA. Australian vertical SaaS at that scale, growing, might trade at **3–5x revenue** or 12–18x EBITDA on a trade sale:

| Exit multiple | Exit value | 30% stake worth | Return on $6.5m | Approx. IRR over 7 years |
|---|---|---|---|---|
| 3x revenue | $83m | $25m | **3.8x** | ~21% |
| 4x revenue | $111m | $33m | **5.1x** | ~26% |
| 5x revenue | $139m | $42m | **6.4x** | ~30% |

*(These assume no further dilution from later rounds, which is optimistic. A Series A would reduce the stake and the multiple.)*

**A 4–6x return over seven years is a genuinely good outcome for most investors — and it is below what a classic venture fund needs from a winner.** The reason is not execution. It is the ceiling: **the entire Australian market at these prices is $37.6m–$51.7m of annual revenue** (§9). A fund needs to believe in a path to hundreds of millions, and this business does not have one without international expansion or a materially different ARPU.

### 13.3 What that means for who to approach

**Likely a poor fit:** a classic venture fund looking for a fund-returner. They will do the ceiling arithmetic in the first meeting, and it is better that you do it for them than that they do it to you.

**Likely a good fit:**

- **Angels and family offices**, who are content with 4–6x and often understand the sector
- **Strategic investors** — a practice management vendor, a payment rail, a health insurer. They value distribution and defensive positioning, not just the multiple, and can pay above a financial buyer
- **Revenue-based financing**, once there is $2m+ of recurring revenue. Non-dilutive, repaid as a share of revenue, and well suited to a predictable subscription base
- **Debt**, later, against contracted recurring revenue

**And the non-dilutive money you should chase first:**

**The R&D Tax Incentive.** A company with turnover under $20m gets a **refundable offset of the company tax rate plus 18.5 points — 43.5%** of eligible R&D spend, paid in **cash**, whether or not you are profitable. For this business, eligible spend is largely engineering salaries.

| | FY27 | FY28 | FY29 | FY30 | FY31 |
|---|---|---|---|---|---|
| Estimated refund | — | $0.37m | $0.70m | $1.05m | $1.34m |

*(Assumes ~60% of payroll is eligible R&D, claimed in arrears so cash lands the following year.)*

**Effect on scenario 4 including the two specialists and the infrastructure floor:**

| | Cash trough | Cash-flow positive | Raise needed |
|---|---|---|---|
| Without the R&D incentive | ($6.58m) | FY30 | ~$7.3m |
| **With the R&D incentive** | **($5.52m)** | **FY30** | **~$6.3m** |

**About $1m less equity to sell — roughly 4–6 percentage points of founder dilution** at these valuations, for the cost of proper record-keeping and a registration each year. **Verify the current rate and eligibility rules with an R&D tax adviser** — the scheme's parameters change and eligibility for software development is assessed carefully.

### 13.4 The uncomfortable summary

The model says this can be a **profitable, cash-generative, $20–28m revenue Australian business** that repays its capital in about five and a half years. That is a good business and a good outcome for the people who build it.

It is **not**, on these assumptions, a venture-scale outcome — and the constraint is the size of the Australian market, not the quality of the product. Anyone raising against it should either target investors whose return expectations match that shape, or have a credible answer to the ceiling **before** the first meeting rather than during it.
