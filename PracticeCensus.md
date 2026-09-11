# PracticeCensus.md — counting Australian practices by type and size
### v0.1 · 7 September 2026 · Plan, not results. Owner: Carl. Companion to GA-PLAN.md (market) and aob-requirements.md §12.6a (which agreement types each practice type can hold).

## 0. Objective

Estimate, for every practice type that can bulk bill under Medicare, **how many practices there are, how big they are, how many patients they serve, and how many assignment-of-benefit agreements a year they would generate.** GP first, then specialists by specialty, optometry, allied health by profession, and the excluded types for completeness.

Australia publishes nothing at practice level. England's NHS practice census has no equivalent here. Every number below is therefore **assembled** from registers and business counts and then **modelled** for volume. Results are presented as bands with the method stated, never as point estimates.

## 1. Why the type split matters to AoBPlatform

The agreement type a practice can use is fixed by the regime, not by us, and it changes the volume model per type:

| Practice type | Agreement types available | Source |
|---|---|---|
| General practice | Enduring (per practitioner × patient, MyMedicare pathway) **and** episodic pre/post | REQ-END-01a |
| Specialists, allied health, optometry, nurse practitioners | Episodic only. Treatment Plan Assignment (≤6 months, enumerated dates, same practitioner) is their only volume mechanism | REQ-END-01a, REQ-PLAN-06 |
| Pathology, diagnostic imaging | s 65C(4) items 1–4, different data sets | **Out of scope** (CLAUDE.md §8) |
| Dental under CDBS, any DVA-funded care | Excluded at primary source (FAQ p. iii) | **Out of scope** (CLAUDE.md §8) |

Consequences for the census:
- **GP** volume is patients on enduring agreements plus episodic agreements for the rest. One enduring agreement covers a year of visits; counting items would overstate GP agreements by an order of magnitude ("agreement ≠ item", CLAUDE.md §3).
- **Non-GP** volume is closer to one agreement per bulk-billed service, less the share that fits a Treatment Plan Assignment (dialysis, oncology, palliative, regular allied series).
- **Dental** is counted so the market map is complete, but flagged not addressable. Private dental has no Medicare rebate; the Medicare dental that exists (CDBS) is excluded. Do not size a dental product from this work.
- **Bulk-billing propensity** differs sharply by type and is the multiplier that turns "practices" into "addressable practices". It is published (see §4.4), so the model uses it rather than assuming everyone bulk bills.

## 2. Outputs

Three tables and a method note.

1. **Practice spine** — one row per physical site: G-NAF address id, practice type(s), ABN set, NHSD organisation id, accreditation status, state/SA2/PHN.
2. **Size by site** — practitioner headcount (by profession and specialty), FTE estimate, size band, employing-business size band from ABS.
3. **Volume by type × geography** — practices, practitioners, modelled patients, bulk-billed services, modelled agreements a year split enduring / episodic / treatment-plan, each as low–mid–high bands.
4. **Method note** — every source, its access terms, its known errors, and the reconciliation results (§6).

Plus a one-page **addressable-market view** for the GA plan: practices × bulk-billing propensity × agreement volume, by type, with the PMS each type predominantly runs (see PMS_to_AoB_Workflow.md for the vendor list).

## 3. Taxonomy — the mapping that holds the assembly together

Each source classifies practices differently. Build this crosswalk first; everything else joins through it.

| Practice type (ours) | ANZSIC 2006 | Ahpra profession / specialty | NHSD service type | MBS statistics category (Broad Type of Service) |
|---|---|---|---|---|
| General practice | 8511 General Practice Medical Services | Medical practitioner, specialty General practice; also non-VR GPs and registrars | General practice | GP non-referred attendances |
| Specialist — by specialty | 8512 Specialist Medical Services | Medical practitioner, each recognised specialty (physician sub-specialties, surgery sub-specialties, psychiatry, paediatrics, obstetrics & gynaecology, dermatology, ophthalmology, anaesthesia, etc.) | Specialist services, coded per specialty | Specialist attendances, obstetrics, anaesthetics, operations |
| Optometry | 8532 Optometry and Optical Dispensing | Optometrist | Optometry | Optometry |
| Allied health — Ahpra-registered | 8533 Physiotherapy; 8534 Chiropractic and Osteopathic; 8539 Other Allied Health | Physiotherapist, chiropractor, osteopath, podiatrist, psychologist, occupational therapist | Per profession | Allied health |
| Allied health — self-regulated | 8539 Other Allied Health; 8599 Other Health Care n.e.c. | Not on Ahpra: dietitians, speech pathologists, exercise physiologists, audiologists, diabetes educators, mental-health social workers. Use each profession's accrediting body register | Per profession | Allied health |
| Nurse practitioners | 8511 / 8599 depending on setting | Nurse practitioner endorsement | Nursing | Included in attendances |
| Dental (map only) | 8531 Dental Services | Dentist, dental specialists, oral health therapists | Dental | Dental (CDBS) |
| Pathology / DI (map only) | 8520 Pathology and Diagnostic Imaging Services | Medical radiation practitioner; pathologists under medical | Pathology, imaging | Pathology, diagnostic imaging |

Verify each ANZSIC code and the exact list of Ahpra recognised specialties against the published classifications before use; the table above is the working assumption, not a source.

The specialist column is the awkward one. "Practice" is a fuzzier unit for specialists: many work from private rooms plus one or more hospitals, some share rooms with unrelated specialists, and the site that bills is often a rooms-management company. Decide the counting unit up front: **billing site** (a rooms address at which at least one specialist bills privately), not "specialist". Report specialists per site and sites per specialist.

## 4. Sources, by layer

### 4.1 The list layer — who exists

| Source | Gives | Covers | Access | Known errors |
|---|---|---|---|---|
| ABR bulk extract | ABN, entity name, entity type, postcode, self-reported ANZSIC | All types | Free (data.gov.au) | ANZSIC self-reported, often blank or a service-entity code; one ABN spans sites; trusts and service entities hide the trading practice |
| NHSD (Healthdirect) | Organisation and service profiles, SNOMED CT-AU service types, location | All types | FHIR API needs authorisation; AURIN publishes a spatial snapshot (June 2025) for academic use by agreement; others apply | Coverage is best where PHNs maintain it (GP, allied); specialist rooms patchier |
| AGPAL / QPA accreditation directories | Accredited GP practices | GP only | Publicly searchable | Only accredited practices (most, because PIP requires it); not the small unaccredited tail |
| Practice Incentives Program public data | Counts of PIP-registered practices by geography | GP only | Department publishes aggregates | Aggregates, not names; use as a denominator |
| Optometry Australia / Optometry Board | Member practices; corporate chain store lists | Optometry | Members list on request; chains publish store locators | A small number of corporate chains cover a large share of sites — count sites, not companies |
| Profession bodies (APA, ADA, Dietitians Australia, SPA, ESSA, Audiology Australia) | Practice finders, member counts | Allied, dental | Public finders; bulk lists on request | Voluntary membership; finder listings are self-maintained |
| Specialist colleges (RACP, RACS, RANZCP, RANZCOG, RANZCO, ACD, ANZCA and others) | Fellow directories, some with practice addresses | Specialists | Public find-a-specialist tools, terms vary | Directories list a preferred address, not every rooms site |
| Cleanbill, PMS vendors, HealthEngine, HotDoc | Practice-level lists with billing policy and booking presence | GP, allied, some specialist | Commercial | Best ground truth for bulk-billing status; cost |

### 4.2 The location layer — where, and deduplicated

- **G-NAF** (Geoscape, free under the open licence) is the spine key. Geocode every candidate address to an `address_detail_pid`. One pid = one site.
- Match ABR, NHSD, accreditation and body directories to the pid. Where two sources land on the same pid with different names, keep both names and one row.
- Attach ABS geography (SA1 → SA2 → SA3 → SA4), PHN, Modified Monash category and state from the pid. Every downstream table is reported at SA3 or PHN because that is where the denominators exist.

### 4.3 The size layer — how big

| Source | Gives | Use |
|---|---|---|
| Ahpra public register | Every registered practitioner with profession, specialty, registration type, **principal place of practice** (suburb/postcode level publicly; street address via data request) | Headcount per site by profession and specialty. Scrape or request the bulk file; the register's terms of use must be checked before any bulk collection |
| National Health Workforce Dataset (NHWDS) and the public Health Workforce Data tool | Registrants, hours, FTE by profession/specialty and geography (down to SA3/PHN) | Denominator for headcounts; FTE ratios per profession to convert heads to FTE |
| ABS Counts of Australian Businesses, including Entries and Exits | Businesses by ANZSIC class × SA2 × employment size band × turnover band | The independent denominator. If the spine has more sites in an SA3 than ABS has businesses in that class, there are duplicates or service entities counted twice |
| HeaDS UPP (Department) | MBS, NHWDS, AGPT, NHSD mapped to 829 GP catchments | Richest for GP; access restricted to organisations with a workforce-planning role. Needs a PHN or university partner |
| PIP practice data | Standardised Whole Patient Equivalent bands by practice (not public per practice) | If obtainable via partner, the best GP size measure that exists |

Self-regulated allied professions have no Ahpra row. Use the accrediting body's register where public (for example Dietitians Australia's APD register, Speech Pathology Australia's CPSP), otherwise body membership counts as a ceiling and Medicare allied-health provider counts (Department workforce reports) as the floor.

### 4.4 The volume layer — what gets bulk billed

- **Medicare quarterly statistics** (Department of Health) publish services, benefits and **bulk-billing rate by Broad Type of Service** and state, quarterly. This is the propensity multiplier per type.
- **Medicare item reports** (Services Australia) publish services by item number × state × month. Aggregate item groups per type to get bulk-billed service counts per geography.
- **MBS statistics by patient geography** (Department, annual) give services and patients per SA3/PHN for GP attendances and some other categories. This is the catchment numerator.
- **Provider numbers** are issued per practitioner per location and are the exact unit "practitioner × site" that an agreement hangs off. They are not published per provider. Ask Services Australia whether **counts of active provider numbers by profession × SA3** can be released; if yes, that is the single best sizing measure for every type and replaces most of §4.3.

## 5. Method, in phases

### P1 — Taxonomy and access (week 1)
- Finalise the crosswalk in §3 against published classifications.
- Pull ABR extract, ABS Counts of Australian Businesses, Medicare quarterly statistics and item reports (all free).
- Lodge access requests: AURIN/NHSD snapshot, Ahpra bulk register terms, Services Australia provider-number counts, one PHN partner for HeaDS UPP.
- Decide and record the specialist counting unit (§3).

### P2 — GP spine (weeks 1–3)
As in the original note: ABR 8511 ∪ AGPAL ∪ QPA ∪ NHSD, geocoded to G-NAF, deduplicated per pid, ABN set attached. Validate SA3 counts against ABS 8511 business counts and PIP practice counts.

### P3 — Extend the spine to the other types (weeks 3–5)
- **Optometry**: chain store locators plus Optometry Australia plus ABR 8532. Chains resolve most of the count quickly.
- **Allied, Ahpra-registered**: NHSD plus profession-body finders plus ABR 8533/8534/8539, then Ahpra principal-place clustering.
- **Allied, self-regulated**: body registers where public; otherwise counts only, no spine rows, flagged as such.
- **Specialists**: college directories plus NHSD plus ABR 8512, clustered to rooms addresses. Expect this to be the weakest layer; report it by specialty with a wider band.
- **Dental, pathology, DI**: ABR and body counts only, no sizing, labelled out of scope.

### P4 — Size each site (weeks 4–6)
- Cluster Ahpra registrants to spine pids by principal place of practice; assign profession and specialty.
- Convert heads to FTE with NHWDS profession-level hours ratios.
- Correct the known Ahpra undercount (multi-site practitioners appear once; some list home or college addresses) by scaling to NHWDS totals per SA3 — never above the ABS business count times a plausible maximum practitioners-per-business for that class.
- Band sites: solo, 2–4, 5–9, 10+ practitioners. Cross-tab with ABS employment bands to sanity-check.

### P5 — Model patients and agreements (weeks 6–7)
Run two methods per type and compare.

- **FTE method**: FTE per site × patients per FTE. GP: 1,000–1,200 per full-time GP (original note). Other types need a per-profession figure derived from MBS patients ÷ NHWDS FTE for that profession; state the derivation.
- **Catchment method**: bulk-billed services in the SA3 for the type's item groups, allocated to sites in proportion to headcount, divided by services per patient per year for that type (GP ≈ 6–7; derive the others from MBS patients and services).

Then convert to **agreements**, by type:
- GP: enduring uptake share × enrolled patients (one agreement each per practitioner, renewed per the enduring rules) + (1 − uptake) × bulk-billed GP patient-days as episodic. Present enduring uptake as a scenario (low / mid / high), since it is a behaviour nobody has observed yet.
- Specialists, allied, optometry: bulk-billed services, grouped to practitioner × patient × day (REQ-SCOPE-01), less the share modelled as Treatment Plan Assignment series.

Where the two methods diverge by more than 25% for a site, the headcount is suspect; flag it for P6.

### P6 — Validate (week 7)
- Sample 50 GP sites, 20 specialist rooms, 20 allied, 10 optometry; check each against its website, HotDoc/HealthEngine listing and Ahpra by hand. Report precision and recall of the spine and the headcount error.
- Reconcile every SA3 to ABS business counts and NHWDS registrant counts; publish the residuals.
- Reconcile national bulk-billed service totals to the Medicare quarterly statistics; the model must sum to the published figure by type.

### P7 — Addressable market view (week 8)
Practices × bulk-billing propensity × agreements a year, by type and PMS. This feeds GA-PLAN.md pricing tiers (REQ-MP-03) and the adapter order in PMS_to_AoB_Workflow.md.

## 6. Type-specific traps

- **GP**: service-entity ABNs; corporate groups (one ABN, dozens of sites); after-hours deputising services that look like practices but hold no patient panel; Aboriginal Community Controlled Health Organisations, which are practices but often classified under 8599 or as not-for-profits.
- **Specialists**: hospital-only practitioners have no rooms and generate no private bulk billing; visiting specialists in regional towns bill from a rooms address they use one day a month; anaesthetists bill from home addresses. Bulk-billing propensity varies more within specialties than between practice sizes.
- **Optometry**: chains dominate the site count; independents dominate the body membership. Count both, reconcile to ABS 8532.
- **Allied**: high solo share, high mobile and home-visit share (no premises), NDIS-funded work that is not Medicare at all. Medicare allied billing is concentrated in the chronic-disease and mental-health item groups; the practices that bill those are a subset of all allied practices.
- **Nurse practitioners**: small, growing, and split between GP settings and standalone clinics; count as a profession within sites rather than as a practice type unless standalone.
- **Dental**: count, then stop. Do not model volume.

## 7. Confidence and cost

| Layer | Expected confidence | Effort (one analyst, free sources) |
|---|---|---|
| GP site list and headcount | Good: ±10–15% headcount, site list near-complete for accredited practices | 2–3 weeks (original estimate) |
| Optometry | Good: chains are enumerable | 2–3 days |
| Allied, Ahpra-registered | Fair: site list incomplete for mobile and solo; headcount fair | 1 week |
| Allied, self-regulated | Counts only | 2 days |
| Specialists by specialty | Weak at site level; fair at specialty × SA3 headcount | 1–2 weeks |
| Patient and agreement volumes | Bands only, ±25–40% by type | 1 week for both methods and reconciliation |
| Total | | **7–8 weeks**, or 3–4 with the Services Australia provider-number counts or a PHN HeaDS UPP partner |

Commercial data (Cleanbill, PMS vendors) would cut GP and allied to days and add bulk-billing status per practice. For AoBPlatform the PMS vendors matter more: they hold the ground truth on sites, practitioners and billing, and they are the distribution channel.

## 8. Decisions for Carl

1. **Counting unit for specialists**: billing site (recommended) or practitioner.
2. **Geography for reporting**: SA3 (finer, noisier) or PHN (coarser, matches HeaDS UPP and workforce planning). Recommend both, PHN as the headline.
3. **Enduring uptake scenarios** for the GP agreement model: propose 20 / 40 / 60% of bulk-billed GP patients within two years, to be replaced by observed data once the regime runs.
4. **Buy or build**: spend on Cleanbill or PMS-vendor data now, or run the free assembly first and buy only where the bands are too wide to price from.
5. **Partner**: approach a PHN for HeaDS UPP access, and Services Australia for provider-number counts. Both are letters, not code.
6. **Where the data lives**: a `research/practice-census/` folder in this repo (scripts, crosswalk, method note; no commercial data committed) or a separate repo.

## 9. Not in this plan

No scraping of any register whose terms forbid it. No individual practitioner data stored beyond profession, specialty and site. No patient-level data of any kind. Nothing here touches the product code, the vault, or any PII path.

## Change log
| Date | Change |
|---|---|
| 7 Sep 2026 | v0.1. Extends Carl's GP census note to all practice types; ties each type to its agreement types; adds taxonomy crosswalk, per-type sources and traps, provider-number ask, phases, confidence table and open decisions. |
