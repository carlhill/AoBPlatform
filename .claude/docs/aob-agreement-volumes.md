# Estimated new AoB agreements per year, by segment
### 19 August 2026 · Method and numbers

**These are agreements, not items.** The earlier chart counted bulk-billed items. An agreement covers one practitioner, one patient, one day — and an enduring agreement covers all future items indefinitely. The two numbers move in opposite directions.

---

## 1. Method

```
  bulk-billed encounters
        − encounters covered by an existing enduring agreement
        − encounters folded into a 6-month plan agreement
        = new episodic agreements per year
        + new enduring agreements created that year
        = TOTAL NEW AGREEMENTS PER YEAR
```

Key inputs, all sourced or flagged:

| Input | Value | Basis |
|---|---|---|
| GP attendances per year | 167.2m | AIHW 2024-25 |
| GP bulk-billing rate | 80.9% FY26 → 90% target 2030 | Medicare statistics; policy target |
| Referred specialist attendances | 35.6m, ~30% bulk billed | AIHW 2024-25 |
| Allied health Medicare attendances | 28.0m | AIHW 2024-25 |
| Optometry services | >11m, ~94% bulk billed | Optometry Australia; Insight |
| MyMedicare registrations | 2.6m (Mar 2025) → **6m assumed by 2030** | UNSW; growth assumed |
| Residential aged care residents | ~196,000, ~17 GP attendances each | AIHW |
| ACCHO/AMS patients | ~410,000 | NACCHO |
| **Enduring uptake among eligible patients by 2030** | **40% — assumed** | No basis; it is optional and "if offered" |
| **Enduring agreements per patient** | **1.4 — assumed** | Per practitioner, so a patient seeing two GPs signs twice |
| **6-month plan agreement adoption, non-GP by 2030** | **50% — assumed** | No basis |

---

## 2. The numbers

### New agreements created per year (millions)

| Segment | FY27 | FY31 | Direction | Why |
|---|---|---|---|---|
| **General practice — episodic** | **132** | **124** | ↓ | Items rise, but enduring agreements absorb an increasing share of encounters |
| **General practice — new enduring** | **0.3** | **0.9** | ↑ | A one-time enrolment per patient per practitioner, plus replacement |
| **Specialists** | **10.7** | **9.3** | ↓ | Volume grows ~2%/yr but plan agreements fold multi-visit courses into one |
| **Allied health** | **22.4** | **13.2** | ↓↓ | Largest collapse — a 5-item chronic disease course becomes one plan agreement |
| **Optometry** | **10.3** | **10.0** | → | Mostly single-visit episodes; little to fold |
| **Pathology and imaging** | ~30 | ~32 | ↑ | One agreement per request, covering many items. Own data set, out of first release |
| **TOTAL (excl. pathology and imaging)** | **~176m** | **~157m** | **↓ 11%** | |

### The two forces, stated plainly

**Agreement volume falls while item volume rises.** Bulk-billed items go from roughly 358m to 400m by 2030. Agreements go from roughly 176m to 157m over the same period, because enduring agreements and 6-month plan agreements each replace many capture events with one.

**This is the correct outcome for the customer and a trap for the vendor.** Every agreement you remove is work you removed from a practice — which is exactly what they are paying for. If you price per agreement, doing your job well destroys your own revenue.

---

## 3. Post-claim notices — the chargeable comms line

You are right that there is a per-message revenue line here. But it is **not** proportional to the items chart, and the difference matters.

**Reg 89AA notices apply only to MyMedicare enduring agreements.** Not episodic. Not residential aged care. Not ACCHO or AMS. One notice per claim, within 24 hours, containing the practitioner name, patient name, date of service and benefit amount.

### Estimated national notice volume

| | FY27 | FY29 | FY31 |
|---|---|---|---|
| Patients holding a MyMedicare enduring agreement | 0.2m | 1.2m | 2.4m |
| GP visits per year, this cohort *(assumed 10 — older and more chronic than average)* | 10 | 10 | 10 |
| **Notices required nationally per year** | **~2m** | **~12m** | **~24m** |

At 5c per notice that is roughly **$1.2m a year across the entire market** by FY31. At 20% market share, about **$240,000 a year** — real, high-margin, and growing, but not a business on its own.

### Why it matters more than the revenue

**It hedges the agreement-volume decline.** Enduring agreements cut the number of agreements *and* create the notice stream. The two move in opposite directions, so a pricing model with a per-practitioner base plus a per-notice usage line is naturally balanced: as enduring succeeds, one line falls and the other rises.

### One caution

The notice is a **statutory obligation on the practitioner**, and the patient cannot opt out of it. Charging a large per-message fee for something a practice is legally compelled to send, and a patient legally cannot decline, will read badly the first time anyone looks closely. Price it at or near cost recovery, make the margin on the platform, and say so openly. It is also the right answer commercially — a cheap notice line makes enduring enrolment easier to sell, and enduring enrolment is where the campaign revenue is.

---

## 4. What is assumed, and therefore weak

- **Enduring uptake of 40%** is the single largest assumption in this document and has no evidential basis. At 10% uptake the agreement decline nearly disappears and the notice line is a quarter of the size.
- **1.4 enduring agreements per patient** is a guess about how many GPs a patient sees regularly.
- **10 GP visits a year** for the MyMedicare cohort is an inference from that cohort being older and more chronic, not a measured figure.
- **50% plan agreement adoption in non-GP segments** assumes a product exists that makes it easy. Today none does.
- **Pathology and imaging** figures are the weakest here — one agreement covers a whole request, and no published figure gives requests rather than items.
- Nothing in this document has been validated against a real practice's data. The design-partner instrumentation is what turns these into observations.
