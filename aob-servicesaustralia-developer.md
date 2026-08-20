# Services Australia Developer Program — What It Is, What It Costs, What We'd Use It For
### Addendum to Requirements v0.3 · 19 August 2026

---

## 1. The headline: it's free

**No registration fee. No portal fee. No test-environment fee. No NOI fee. No annual maintenance fee.**

The strongest evidence is the contract itself. The **Services Australia 2020 Interface Agreement v2.1** grants a *"non-exclusive, **royalty-free**, revocable licence"* to use Services Australia material to develop, test, operate and support your product — and contains **no fee, charge or payment clause of any kind**.

Corroborating: the adjacent ADHA HI Service conformance assessment is explicitly stated as conducted *"at no cost"*, and no fee schedule appears on any page of the developer portal, the programs list, the registration guide, or the get-started page.

**Honest caveat:** no page says in words "there is no fee to register." The conclusion rests on a royalty-free licence with no payment clause, an explicit "at no cost" on the adjacent step, and the absence of any fee schedule anywhere. Strongly supported, not verbatim-confirmed. Worth a 5-minute call to Developer Liaison to close.

---

## 2. Where the money actually goes

The fees are zero. The **compliance obligations are not**, and several are hard cost floors.

| Obligation | Cost position |
|---|---|
| **IRAP assessment** (cloud-hosted products) | **Vendor/CSP funded.** The security policy states plainly: *"The agency will not be held responsible for funding or conducting the IRAP assessment."* Current assessment required, report provided to the agency, re-review after major environmental change. **This is the big one — IRAP assessments are five figures.** |
| **Penetration testing** | Vendor-funded. **Mandatory** after major API/Web Service releases (since March 2022). |
| **Security code review** | Vendor-funded. Recommended, and attested at certification. |
| **Onshore everything** | All software development, testing, operation and support must be **conducted within Australia** unless approved in advance in writing. All production data in Australian jurisdiction. A **product support office must be Australia-based**. No offshore dev team. |
| **Encryption** | ASD-approved algorithm, at rest and in transit. |
| **ACSC Essential Eight maturity level 3** | Recommended ("should"). Not free to reach. |
| **AGSVA personnel vetting** | Vendor obligation. NV1 clearance recommended for permanent privileged access, Australian citizens only. |
| **ANAO / appointed auditor access** | Mandatory cooperation, full access to premises, equipment and data "at all reasonable times." Vendor bears its own cost of assisting. |
| **Incident reporting** | Cyber incident within **12 hours**. Data breach within **2 business days**. Needs an actual on-call process. |
| **Indemnity** | Vendor indemnifies Services Australia; the agency excludes liability broadly. Either party may terminate immediately for any reason, and Services Australia may revoke Product Certification on termination. |
| Insurance | **No insurance requirement found** in the Interface Agreement. |
| PRODA, NASH test certificates, DTSS, OTS support | No fee found. |

**Read the asymmetry.** Registration is free; the security posture it obliges is not. For a cloud product, IRAP plus pen testing plus onshore-only development is the real entry price, and it is materially more than the $125-once-off end of this market is used to paying for anything.

---

## 3. What the program actually gives you

Ten programs. For our purposes, only three matter.

| Program | Relevance to us |
|---|---|
| **Medicare Online** (incl. ECLIPSE, DVA) | Claim lodgement. **Not our product** — we don't lodge. |
| **MyMedicare Web Services** | 🔴 **Directly relevant. See §5.** Perform MyMedicare functions from practice software. |
| **Healthcare Identifiers (HI) Service** | 🔴 **Directly relevant. See §5.** Retrieve IHIs. |
| AIR, PBS Online, PBS Authorities, Aged Care Web Services, Chronic Wound Consumables | Not relevant. |

The onboarding sequence, if we ever do it: individual PRODA account → organisation registration in the Health Systems Developer Portal (by a director or ABR/ASIC-listed authorised officer) → accept the Interface Agreement → invite staff (up to 2 working days) → develop → preliminary testing → integration testing via DTSS with the Product Integration team → **Notice of Integration (NOI)** issued per product version and per function → customers get Minor IDs and activate B2B devices.

---

## 4. The direct answer on AoB: we probably need none of it

**If our product only creates, verifies, signs, stores and writes AoB agreements into a PMS — and never transmits anything to a Services Australia channel — there is nothing to register for.**

- The **Interface Agreement is scoped to parties who interface with Services Australia's systems via web services APIs**. No interface, no agreement.
- The **NOI certifies that a software version "has been tested for use with online claiming for the functions specified."** No claiming functions, nothing for an NOI to attest.
- **There is no AoB conformance scheme.** No AoB conformance profile, no AoB test specification, no AoB declaration form, and no AoB entry on the Software Developer Impact Roadmap. ADHA's registers cover ePIP, HI Service, My Health Record and Secure Messaging only.
- **There is no published list of AoB-conformant vendors**, so there is no list to be absent from.
- **ADHA conformance (NoC / CCD) is not required** — that covers My Health Record, HI, e-prescribing and secure messaging. AoB is a Health Insurance Act matter with no ADHA profile.

**So what did the Department's FAQ mean by "many software vendors have completed a conformance process undertaken with Services Australia"?**

Best available inference: it refers to the **ordinary NOI product-integration testing applied to updated claiming software versions carrying the new AoB data**. AoB metadata now travels with the claim — Best Practice's VIP.net notes describe new implied/requested assignment radio buttons on ECLIPSE claims and an updated DB4 form. Changing claim payloads triggers a new NOI under the version-scoped model. **That is a PMS vendor's obligation, not ours.** Not confirmed from a primary source.

**The practical consequence for us:** the AoB metadata must reach the PMS in a form its own NOI'd claiming module can transmit. The integration burden lands on the PMS partner's NOI, not on ours. This reinforces that **Medtech write-back is the whole ballgame** (REQ-INT-02).

⚠️ **The line we must not cross accidentally.** If the product ever reads Medicare eligibility, resolves an IHI, checks MyMedicare status, or touches any Services Australia API — **even read-only** — it enters scope and everything in §2 and §3 applies, IRAP included. That has to be a deliberate decision, not something a developer does one afternoon because an endpoint looked useful.

---

## 5. Two reasons we might want in anyway

Registration is not needed for the core product. But two APIs solve problems our design currently has no good answer to.

### 5.1 MyMedicare Web Services → enduring agreement eligibility and cessation

Our enduring design has an unsolved dependency. **REQ-END-07** requires cessation monitoring: an enduring agreement automatically ceases when the patient stops being registered with the relevant MyMedicare practice. An agreement that silently ceased and is still being relied on produces claims that were **never validly assigned** — recoverable on audit.

Right now we would infer MyMedicare status from PMS data, which is stale by construction. **MyMedicare Web Services would let us verify registration status at source**, which turns cessation monitoring from a guess into a check, and gates enduring enrolment on actual eligibility rather than a receptionist's recollection.

That is a genuine reason to register — and a defensible differentiator, since no engagement-layer vendor has shipped enduring at all.

### 5.2 HI Service → the IHI as an approved identifier

The **Individual Healthcare Identifier is one of the six RACGP-approved patient identifiers** (REQ-VER-02). Practices with incomplete demographic data may not have three reliable identifiers on file; an IHI is unique, unambiguous, and unlike the Medicare number it *is* on the approved list.

Retrieving IHIs would strengthen the verification product — but note HI Service integration requires a **Notice of Connection (NoC)** and ADHA conformance assessment (free, but a process), and pulls us into full scope.

### 5.3 Recommendation

**Not in v1.** Ship the core product with PMS-sourced identifiers and PMS-inferred MyMedicare status. Revisit at the point enduring agreements become a real revenue line — the IRAP and onshore-only obligations are a serious cost to take on before the product has proven demand.

**But do register the organisation now anyway.** Registration is free, gives portal access, gets us on the notification list for the Software Developer Impact Roadmap, and — the actual point — **gives us a Developer Liaison relationship before we need one**. It commits us to nothing until we accept the Interface Agreement and start interfacing.

---

## 6. The commercial angle worth being honest about

The Department's FAQ tells practices to *"consult their software vendor to determine whether assignment of benefit agreements can be created, recorded and retained through their practice management software,"* and notes many vendors completed a Services Australia conformance process.

**Practices will therefore ask us whether we are "conformant," and the honest answer is that no AoB conformance exists to hold.** That's an awkward sales conversation unless we get ahead of it.

Recommended answer, which is true and stronger than a dodge:

> There is no Services Australia conformance scheme for assignment-of-benefit agreements — the Department has confirmed it *"is unable to review, approve or provide assurance on assignment of benefit agreement templates."* Services Australia conformance (a Notice of Integration) covers **claim transmission**, which your PMS does and we don't. What we provide instead is a documented, versioned **s 65C conformance statement** for every agreement we generate, which is the evidence you'd produce in an audit.

That reframes an absence into an artefact — and it is exactly what the free compliance tester (REQ-TEST-\*) exists to back up.

---

## 7. One deadline to note

**NASH PKI reaches end-of-life September 2026**, with transition to be completed by **September 2028**, after which NASH ceases. Irrelevant if we stay out of scope; a migration project if we go in. Another argument for deferring §5 rather than building against an authentication stack that is being retired.

---

## 8. Contacts

| Purpose | Contact |
|---|---|
| Developer Liaison | `developerliaison@servicesaustralia.gov.au` |
| Developer support / portal registration | `devsupport@servicesaustralia.gov.au` |
| Online Technical Support (Software Vendor Technical Support) | 1300 550 115 |
| IT security / Third Party Security Policy | `ITSA@servicesaustralia.gov.au` |
| PRODA support | 1800 700 199 |
| AoB policy (Department) | `AssignmentofBenefit@health.gov.au` |

---

## 9. Actions

1. **Register the organisation in the Health Systems Developer Portal.** Free, low commitment, needs a director or ABR/ASIC-listed authorised officer. Do it now for the relationship and the roadmap notifications.
2. **Call Developer Liaison** to confirm (a) that registration and NOI carry no fee, in words, and (b) what the "AoB conformance process" in the Department's FAQ actually refers to.
3. **Draw the API line explicitly in the architecture** — an engineering decision record stating that the product does not call Services Australia APIs in v1, and that doing so requires a deliberate scope decision because it triggers IRAP, onshore-only development, and NOI.
4. **Add the "are you conformant?" answer to the sales script** before the first customer conversation.

---

### Sources

- [Get started as a software developer — Services Australia](https://www.servicesaustralia.gov.au/get-started-software-developer?context=20)
- [Health Systems Developer Portal — Programs](https://healthsoftware.humanservices.gov.au/claiming/ext-vnd/page/programs)
- [Services Australia 2020 Interface Agreement v2.1 (PDF)](https://healthsoftware.humanservices.gov.au/claiming/ext-vnd/sites/claiming.ext-vnd.healthsoftware.humanservices.gov.au/files/agreements/Services%20Australia%202020%20Interface%20Agreement%20v2.1.pdf)
- [Integrated Third Party Security Policy v2.1 (PDF)](https://healthsoftware.humanservices.gov.au/claiming/ext-vnd/sites/claiming.ext-vnd.healthsoftware.humanservices.gov.au/files/agreements/Services%20Australia%20Integrated%20Third%20Party%20Security%20policy%20v2.1.pdf)
- [How to register your Organisation in the software developer portal (PDF)](https://healthsoftware.humanservices.gov.au/claiming/ext-vnd/sites/claiming.ext-vnd.healthsoftware.humanservices.gov.au/files/2020-07/How%20to%20register%20your%20Organisation%20in%20the%20software%20developer%20portal.pdf)
- [Healthcare Identifiers Service for software developers](https://www.servicesaustralia.gov.au/healthcare-identifier-hi-service-for-software-developers?context=20)
- [Medicare Online for software developers](https://www.servicesaustralia.gov.au/medicare-online-for-software-developers?context=20)
- [ADHA — My Health Record NoC and CCD testing](https://developer.digitalhealth.gov.au/resources/my-health-record-notice-of-connection-noc-and-conformance-compliance-and-declaration-ccd-testing)
- [ADHA conformance registers](https://www.digitalhealth.gov.au/about-us/policies-privacy-and-reporting/registers)
- [Software Developer Impact Roadmap, October 2025 (PDF)](https://healthsoftware.humanservices.gov.au/claiming/ext-vnd/sites/claiming.ext-vnd.healthsoftware.humanservices.gov.au/files/miscellaneous-files/IDMO%20Software%20Developer%20Impact%20Roadmap%20-%20October%202025.pdf)
- *Assignment of Medicare Benefits for Bulk Billing — FAQ*, DoHDA, 16 July 2026, pp. 11, 28
