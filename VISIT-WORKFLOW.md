# AoB visit workflow — Patient / PMS / AoBPlatform / Medicare

*v0.1 · 12 September 2026. Companion to `PMS_to_AoB_Workflow.md` (how the agreement reaches the patient) and `PATIENT-WORKFLOW-PAGE.md`. Rendered swim-lane: `VISIT-WORKFLOW.svg` / `VISIT-WORKFLOW.html` beside this file, and the claude.ai artifact "AoB Visit Workflow".*

## The rule the diagram is built around

**The PMS cannot bill unless an enduring or episodic agreement has been approved by the patient.** The agreement must be on file for this practitioner on this day before the PMS raises a bulk-bill claim. Everything before the gate exists to get that approval in place; everything after it assumes the approval exists and reconciles against it.

- **Enduring agreement** — stands across visits with one named GP (coverage is per practitioner, across locations); satisfies the gate on every later visit without a new capture.
- **Episodic agreement** — covers one practitioner on one day; a patient seeing two providers on the same day needs two.
- **No approved agreement** — the PMS shows the status and takes no claim. AoBPlatform re-enters the capture cascade (tablet → SMS/email link → paper → assignor pathway). Declined → private bill with a claimable invoice. Verbal fallback is recorded and risk-flagged until 30 June 2027 only.

## Pre-billing

| Step | Patient | PMS | AoBPlatform | Medicare |
|---|---|---|---|---|
| Pre-visit | Books (phone / HotDoc / AutoMed). May open the pre-visit link and approve the agreement. | Appointment written; reminder SMS; OPV card check; account type set (bulk bill). | Reads the appointment book; sends the pre-visit agreement link (SMS / email). | Answers OPV: card valid, details match. |
| Arrival & check-in | Arrives; RACGP 3-point ID check (name, DOB, address — never the Medicare number). If nothing on file, approves on the tablet (< 45 s). | Patient found or registered; marked ARRIVED; posts the arrival contract (`POST /arrivals`: patient, five details, provider number, time — **no agreement type**); agreement status displayed. | On the arrival: visit policy decides enduring / episodic / none (GP-only rule, existing enduring cover with this practitioner across locations, prior declines, practice default). If nothing approved is on file: tablet capture, staff-assisted verification, validate, lock, render, vault, **write status back to the PMS record**. | — |
| Consultation | Consult. | GP records notes; selects MBS item(s). | Holds status: APPROVED / PENDING / DECLINED. | — |

## Billing gate (PMS lane)

`Approved agreement on file for this practitioner today?`

- **YES** → invoice finalised, bulk-bill claim lodged. Nothing reaches Medicare until this point.
- **NO** → capture cascade or private bill; loop back to the arrival check.

## Post-billing

| Step | Patient | PMS | AoBPlatform | Medicare |
|---|---|---|---|---|
| Billing & claim | Assigns benefit → pays nothing. Declined → pays privately, receives claimable invoice. | Invoice finalised; bulk-bill claim lodged via Medicare Online (**the PMS always lodges**). | Reconciles agreement ↔ invoice items (same practitioner, same day); sends patient copy. | Claim received; assessed against MBS. |
| Post-billing | Holds copy. Enduring agreement stands for future visits with this GP. | Processing & payment reports received; rejections reworked. | Matches claim outcome to agreement; exceptions flagged; retained 2 years from the claim. | Benefit paid to practice; processing & payment reports returned. |

## Boundaries worth stating

- The PMS announces the visit; AoBPlatform drafts the agreement and decides its type (versioned visit policy). An arrival that names a type is ignored on that point.
- AoBPlatform never talks to Medicare. It reads the appointment book, writes the agreement and its status into the patient record, and reads the processing/payment reports later.
- The PMS is the register of patients. AoBPlatform keeps no shadow patient list; the only AoBPlatform check at the desk is "is there an approved agreement for this practitioner today?"
- The Medicare card and IRN are billing particulars, never an identity challenge.

## Mermaid source (sequence form)

```mermaid
sequenceDiagram
    participant P as Patient
    participant PMS
    participant AoB as AoBPlatform
    participant M as Medicare

    rect rgb(223,231,226)
    Note over P,M: PRE-BILLING
    P->>PMS: Books appointment
    PMS-->>M: OPV card check
    M-->>PMS: Card valid, details match
    PMS->>AoB: Appointment event
    AoB->>P: Pre-visit agreement link (SMS / email)
    P-->>AoB: Approves enduring / episodic agreement (optional)
    P->>PMS: Arrives, 3-point ID check, marked ARRIVED
    PMS->>AoB: POST /arrivals (patient, five details, provider number, time)
    AoB->>AoB: Visit policy: enduring / episodic / none; approved agreement on file?
    AoB->>P: If none: tablet capture, staff-verified signature
    AoB->>PMS: Write back agreement + status (APPROVED / PENDING / DECLINED)
    P->>PMS: Consultation; GP selects MBS item(s)
    end

    rect rgb(251,238,231)
    Note over PMS: BILLING GATE — PMS cannot bill without a patient-approved enduring or episodic agreement
    alt NO approved agreement
        PMS->>AoB: Re-enter capture cascade (tablet / link / paper) or private bill
        Note over M: Nothing lodged
    else YES
        PMS->>PMS: Invoice finalised
    end
    end

    rect rgb(223,231,226)
    Note over P,M: POST-BILLING
    PMS->>AoB: Invoice items
    AoB->>PMS: Match / mismatch (same practitioner, same day)
    AoB->>P: Patient copy of agreement
    PMS->>M: Bulk-bill claim via Medicare Online
    M->>PMS: Benefit paid; processing & payment reports
    PMS->>AoB: Reports
    AoB->>AoB: Match outcome to agreement; flag exceptions; retain 2 yrs
    end
```
