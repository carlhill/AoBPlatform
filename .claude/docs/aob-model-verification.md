# AoB Business & Cash Model — Verification Pass
### 20 August 2026 · A fresh set of eyes on the models built earlier in this project

## 1. Verdict

**The structure holds. The arithmetic is internally consistent** — I re-derived the scenario-4 P&L independently and it reproduces the workbook to the dollar. The scenario switch, tax-loss mechanics and cash build all behave. Three assumptions, however, are doing more work than the documents admit, and one of them changes the answer.

## 2. The finding that matters: customer acquisition cost is implausibly low

The model funds sales as a % of revenue with a floor. Divide that spend by practices won and the implied CAC is **$650–800 per practice**. Direct field sales to Australian SMB healthcare typically runs **$2,000–4,000 per closed practice** once salaries, travel and cycle time are loaded. Re-running scenario 4 with a per-acquisition cost floor:

| Assumed CAC | Y5 EBITDA | Cash trough | Raise |
|---|---|---|---|
| As modelled (~$700 implied) | $3.28m | ($5.72m) | $6.5m |
| $1,500 | $2.35m | ($7.04m) | ~$7.8m |
| **$2,500** | **$0.22m** | **($10.31m)** | **~$11m** |
| $4,000 | −$2.97m | ($18.21m) | ~$19m |

**At field-sales economics the business barely breaks even and the raise nearly doubles.** The model only works at low CAC — which means low CAC is not an assumption, it is a *requirement*, and the plan must say how: PMS-channel distribution (white-label or referral through Medtech/Zedmed at a 25–30% revenue share), the free reconciliation retrospective as the demo, and self-serve for allied health. A channel share costs ~25% of revenue but takes CAC toward zero; at these numbers that trade is clearly worth it. **This should be slide one of the go-to-market, not a footnote.**

## 3. Two smaller corrections

**Build cost in year one is optimistic.** Eight FTE in FY27 must deliver tablet capture, the s 65C engine, verification, storage, the Medtech integration and the security posture. Best Practice spent ~$1m building *one AoB feature* inside an existing platform. Mitigation: cut FY27 scope (defer kiosk mode and the patient portal; BYO-iPad instead of supplied hardware) rather than add heads.

**Working capital is modelled backwards for a subscription business.** The model assumes 30 debtor days. Card-billed monthly subscriptions collect in ~2 days, and **annual billing in advance makes working capital negative** — customers fund you. Offering 2 months free for annual prepay would improve the trough by roughly $0.5–1m across the ramp at trivial cost. Cheap fix, real money.

## 4. Better ideas, in order of value

1. **Make channel distribution the primary motion** (§2). The single largest de-risking available.
2. **Annual prepay billing** (§3).
3. **Put the R&D Tax Incentive into the base cash flow** rather than a note — ~$1m less equity to sell, already quantified in the cost-model notes §13.
4. **Charge for the reconciliation retrospective after the first year.** Free at signup as the land motion, then annual "revenue assurance review" at $1,500–2,500 — it reuses the engine and prices against found money, the only line not capped by the customer's own saving.
5. **Front-load churn honestly**: 15–20% in a customer's first year, 5–8% thereafter, instead of a flat rate. It worsens Y2–3 slightly and makes the LTV defensible in diligence — better you than them.

## 5. The pharma question, answered

**What "pharma-funded network solutions" means at Phreesia:** while a patient completes digital intake, pharmaceutical companies pay Phreesia to show that patient targeted, condition-relevant health content — a psoriasis-drug awareness message to a patient whose intake indicates psoriasis, sponsored vaccination reminders, clinical-trial recruitment. Pharma pays per campaign/engagement; the patient is the audience, the practice is the venue, and it is ~29% of Phreesia's revenue (~$140m).

**Can AoBPlatform do this in Australia? The US version — no; it is unlawful.** Australia prohibits direct-to-consumer advertising of prescription medicines (Therapeutic Goods Act 1989 and the TGA Advertising Code). A branded prescription-drug message delivered to a patient during consent capture is exactly what the prohibition covers. Only the US and NZ permit DTC prescription advertising.

**What is lawful here** is a narrow strip: unbranded disease-awareness campaigns (tightly policed — a veiled product ad breaches the Code), OTC and consumer-health advertising, government/PHN-funded health promotion (e.g. immunisation reminders), and ethics-approved clinical-trial recruitment. There is an Australian proof point: **MedAdvisor** (ASX-listed) runs pharma-funded medication-adherence and awareness programs through pharmacy software, TGA-compliant — so a compliant version of the revenue line exists at scale in this country.

**My recommendation is still no, for the first several years.** Three reasons: (a) this platform's entire premise is trust — it exists because patients must believe the message asking them to sign is safe, and the fastest way to destroy that is to make the consent channel an ad channel; (b) using health information gathered for consent to target health content is a secondary use under the APPs requiring explicit consent, and it is the same category of conduct that earned **HealthEngine a $2.9m Federal Court penalty** in 2020 (sharing patient information with insurance brokers) — the cautionary tale in exactly this market; (c) the phishing defence we built ("a message from us is always and only about your consent") stops working the day the channel carries anything else.

**The Phreesia number should be read as a warning, not a menu:** standalone intake/consent software struggled to support a big ACV even at US scale, which is why Phreesia diversified into ads and payments. Our answer to the same pressure is the compliance record, reconciliation and managed follow-up — revenue lines that deepen trust instead of spending it. If a pharma-adjacent line is ever wanted, the only version I would consider is government or PHN-funded health-promotion messaging (immunisation reminders), clearly labelled, opt-in, and never targeted off consultation data.

## 6. What still stands unchanged

The ceiling ($37.6–51.7m ARR), the FY30 cash-flow-positive / FY32 repaid trajectory, the adoption-first sensitivity ranking, the "never price per agreement" rule, and the conclusion that this is a strong founder/strategic outcome rather than a venture fund-returner — the verification pass reinforced all of these rather than weakening them.
