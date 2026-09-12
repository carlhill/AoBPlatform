import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  paperworkFor,
  servicesNeedABillingProvider,
  whoTheyCameToSee,
  type AgreementNeeded,
  type WaitingGroup,
  type WaitingList,
  type WaitingRow,
  type WaitingScope,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AffiliationsService } from '../affiliations/affiliations.service';
import type { Actor } from '../auth/actor.decorator';

/** Affiliation statuses that mean somebody is working here now. */
const LIVE_AFFILIATION_STATUSES = ['active', 'ending'] as const;

/** How far a supersession chain is walked forward. Same bound the desk uses. */
const MAX_CHAIN_HOPS = 16;

/**
 * WHO IS WAITING, AND IS THEIR PAPERWORK DONE (PRACTITIONER-QUEUE-PAGE.md §3,
 * §5; Carl 12 September 2026).
 *
 * A READ AND NOTHING ELSE. There is no write on this service and no method
 * that could grow one: §3 says *"no buttons that act on an agreement — a
 * practitioner does not send tablets or correct addresses, and a control they
 * will never legitimately use is a control that will one day be pressed by
 * mistake."* The same reasoning applies a layer down. Nothing here writes, so
 * nothing here needs an outbox event, and the vault is untouched.
 *
 * IT REPORTS; IT DOES NOT GATE (hard rule 8, REQ-REC-04). No caller can be
 * refused a consultation by anything this returns, and a failure here slows
 * the evidence rather than the service.
 *
 * ARRIVALS, NOT AGREEMENTS, ARE THE SPINE. The desk's `pushable` list reads
 * AGREEMENTS and excludes signed ones by construction — which is right for a
 * work queue and wrong here, because "Done" is the answer this page exists to
 * give. It is also the list that cannot show a patient who needs no agreement
 * at all (ARRIVAL-WHO-IS-SEEN.md §3). So this reads the arrivals for today and
 * asks each one what its paperwork came to.
 *
 * WHOSE LIST, DECIDED HERE AND NEVER BY THE CALLER. §4.2: *"Never show another
 * practitioner's list. Scoped to the signed-in practitioner, enforced at the
 * query."* There is no practitioner parameter on any method below — a token
 * carrying a practitioner claim gets that practitioner's list and there is
 * nothing to ask for instead.
 *
 * NO PII LEAVES BUT THE NAME THE ROW IS ABOUT. `WaitingRow` has no field for
 * an identifier value, a date of birth or an amount (hard rules 1, 4, 9), and
 * nothing here logs.
 */
@Injectable()
export class PractitionerQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliations: AffiliationsService,
  ) {}

  /**
   * TODAY'S LIST FOR WHOEVER IS ASKING.
   *
   * TWO MODES, ONE READ (Carl, 12 Sep 2026, widening §3):
   *
   *   - A TOKEN WITH A PRACTITIONER CLAIM gets `mine` — their own patients at
   *     this practice, one group. Checked FIRST, because it is the narrower
   *     answer and a person holding both claims must get the narrower one:
   *     widening by accident is the failure that matters here, and narrowing
   *     by accident is merely inconvenient.
   *   - A TOKEN WITH ONLY A PRACTICE CLAIM gets `practice` — every
   *     practitioner with somebody waiting, grouped. An administrator, a
   *     manager or a receptionist needs to know who is waiting for whom.
   *
   * ACROSS PRACTICES IT FINDS NOTHING. `withPractice` sets the RLS scope, and
   * a practitioner's own practice is checked against their live affiliations
   * before the scope is opened — so a practitioner naming somebody else's
   * practice gets a refusal, and a query that somehow reached the database
   * anyway would still see none of its rows.
   */
  async waiting(actor: Actor | undefined, headerPracticeId: string | undefined): Promise<WaitingList> {
    const practitionerId = actor?.practitionerId;

    if (practitionerId) {
      const practiceId = await this.practiceForPractitioner(practitionerId, headerPracticeId);
      return this.prisma.withPractice(practiceId, async (tx) => {
        /*
         * THEIR AFFILIATIONS AT THIS PRACTICE, READ INSIDE THE SCOPE. A
         * practitioner can hold more than one here — two locations, two
         * departments — and every one of them is theirs. RLS makes anybody
         * else's invisible to this query, so the filter cannot widen.
         */
        const mine = await tx.affiliation.findMany({
          where: { practitionerId, status: { in: [...LIVE_AFFILIATION_STATUSES] } },
          select: { id: true },
        });
        const ids = new Set(mine.map((row) => row.id));
        return this.build(tx, 'mine', (affiliationId) => affiliationId !== null && ids.has(affiliationId));
      });
    }

    const practiceId = requirePractice(headerPracticeId);
    return this.prisma.withPractice(practiceId, (tx) => this.build(tx, 'practice', () => true));
  }

  /**
   * WHICH PRACTICE A PRACTITIONER IS ASKING ABOUT.
   *
   * A PRACTITIONER'S TOKEN CARRIES NO PRACTICE CLAIM, deliberately and by
   * design: they work at several practices and which ones changes, so stamping
   * one on the token would pick a winner arbitrarily
   * (`PractitionerAccessService`). This page is nonetheless about ONE practice
   * — it is *"my work at THIS practice, today"* (§1) — so the practice has to
   * come from somewhere, and the two honest sources are the request and their
   * own affiliations.
   *
   * THE HEADER IS A REQUEST, NEVER A GRANT. Whatever it names is checked
   * against the affiliations the SECURITY DEFINER function returns for this
   * practitioner, and an unlisted practice is refused. It is checked BEFORE
   * `withPractice` opens the scope rather than after, so a wrong id never
   * becomes an RLS setting at all.
   *
   * NO HEADER AND ONE PRACTICE is the ordinary case and needs no question
   * asked. No header and SEVERAL is a real choice the platform must not make
   * for them, and the refusal says so rather than guessing.
   */
  private async practiceForPractitioner(
    practitionerId: string,
    headerPracticeId: string | undefined,
  ): Promise<string> {
    const rows = await this.affiliations.listForPractitioner(practitionerId);
    const live = [
      ...new Set(
        rows
          .filter((row) => LIVE_AFFILIATION_STATUSES.includes(String(row.status) as 'active' | 'ending'))
          .map((row) => String(row.practiceId)),
      ),
    ];

    if (headerPracticeId) {
      /*
       * FAILS CLOSED, AND SAYS WHY WITHOUT SAYING WHOSE. The message names no
       * practice and no person — it is the caller's own scope that is wrong,
       * and a refusal that confirmed a practice exists would be a small
       * directory of practices for anybody with a practitioner account.
       */
      if (!live.includes(headerPracticeId)) {
        throw new ForbiddenException(
          'You do not work at the practice this page was opened for, so there is no list to show you.',
        );
      }
      return headerPracticeId;
    }

    if (live.length === 1) return live[0]!;
    if (live.length === 0) {
      throw new ForbiddenException(
        'You have no current affiliation with a practice, so there is nobody waiting for you here. If that ' +
          'is wrong, ask the practice to check your listing.',
      );
    }
    throw new BadRequestException(
      'You work at more than one practice, so this page needs to know which one you are at today. Choose ' +
        'the practice first and open your waiting list from there.',
    );
  }

  /**
   * THE LIST ITSELF — one transaction, no network calls, nothing written.
   *
   * `keep` DECIDES WHOSE ROWS SURVIVE, and it is applied to the affiliation the
   * patient came to see, before anything else is read. Filtering after the fact
   * would mean the other rows had already been assembled — names and all — and
   * one careless `return` away from being sent.
   */
  private async build(
    tx: Parameters<Parameters<PrismaService['withPractice']>[1]>[0],
    scope: WaitingScope,
    keep: (seeingAffiliationId: string | null) => boolean,
  ): Promise<WaitingList> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    /*
     * TODAY, AND ONLY WHAT WAS ACCEPTED. A refused arrival is not somebody
     * waiting — nothing was mirrored onto the patient and the desk is being
     * asked for a missing field — and putting it on a practitioner's list
     * would be showing them somebody else's admin.
     *
     * ARRIVAL ORDER, WHICH IS RECEPTION'S ORDER (§3, FRONT-DESK-PAGE.md
     * §12.6). Nothing on this page re-sorts it.
     */
    const arrivals = (
      await tx.arrival.findMany({
        where: { arrivedAt: { gte: startOfDay }, outcome: 'received' },
        orderBy: { arrivedAt: 'asc' },
      })
    ).filter((arrival) => keep(whoTheyCameToSee(arrival)));

    if (arrivals.length === 0) return { scope, groups: [] };

    const patients = await tx.patient.findMany({
      where: { id: { in: idsOf(arrivals.map((a) => a.patientId)) } },
      select: { id: true, givenNames: true, familyName: true },
    });
    const patientById = new Map(patients.map((p) => [p.id, p]));

    /*
     * THE NEWEST AGREEMENT IN EACH CHAIN, because that is the one that gets
     * signed. `Arrival.agreementId` names the agreement drafted when the
     * patient walked in — the HEAD of the chain — and a correction supersedes
     * it with a new row the arrival has never heard of. Reading only the
     * arrival's own agreement would show "Not yet" for a patient who signed
     * the successor five minutes ago, which is the single worst thing this
     * page can get wrong.
     */
    const newest = await this.newestInChain(tx, idsOf(arrivals.map((a) => a.agreementId)));
    const agreements = await tx.agreement.findMany({
      where: { id: { in: [...new Set(newest.values())] } },
      select: { id: true, affiliationId: true, signatureEventId: true },
    });
    const agreementById = new Map(agreements.map((a) => [a.id, a]));

    /*
     * WHO HAS A TABLET IN THEIR HANDS RIGHT NOW. The same read the desk makes,
     * and the only thing on this page that changes minute to minute.
     */
    const liveSessions = await tx.tabletSession.findMany({
      where: { endedAt: null },
      select: { agreementId: true },
    });
    const liveByAgreement = new Set(liveSessions.map((s) => s.agreementId));

    /*
     * THE PEOPLE, BY AFFILIATION — the person the patient came to see, and the
     * person the agreement is anchored on, which §6a says are two facts. Read
     * once for the whole list rather than once a row.
     */
    const affiliationIds = idsOf([
      ...arrivals.map((a) => whoTheyCameToSee(a)),
      ...agreements.map((a) => a.affiliationId),
    ]);
    const affiliationRows = await tx.affiliation.findMany({
      where: { id: { in: affiliationIds } },
      select: { id: true, practitionerId: true, billingRole: true },
    });
    // `practitioners` is deliberately not practice-scoped: a practitioner is
    // one human across the platform. Only names are read, and only for
    // affiliations this practice's own RLS already returned.
    const practitionerRows = await tx.practitioner.findMany({
      where: { id: { in: [...new Set(affiliationRows.map((a) => a.practitionerId))] } },
      select: { id: true, givenNames: true, familyName: true },
    });
    const practitionerById = new Map(practitionerRows.map((p) => [p.id, p]));
    const affiliationById = new Map(
      affiliationRows.map((a) => [
        a.id,
        {
          billingRole: a.billingRole,
          name: nameOf(practitionerById.get(a.practitionerId)),
        },
      ]),
    );

    /*
     * GROUPED BY WHO THE PATIENT CAME TO SEE, in the order the first patient
     * for each practitioner arrived. A practitioner's own list is one group;
     * reception's is one per practitioner with somebody waiting.
     */
    const groups = new Map<string, { affiliationId: string | null; practitionerName: string | null; rows: WaitingRow[] }>();

    for (const arrival of arrivals) {
      const patient = arrival.patientId ? patientById.get(arrival.patientId) : undefined;
      // No resolved patient is no row. There is no name to show and inventing
      // a placeholder would put an anonymous person on a practitioner's list.
      if (!patient) continue;

      const seeing = whoTheyCameToSee(arrival);
      const seeingAffiliation = seeing ? affiliationById.get(seeing) : undefined;

      const agreementId = arrival.agreementId ? newest.get(arrival.agreementId) : undefined;
      const agreement = agreementId ? agreementById.get(agreementId) : undefined;

      const row: WaitingRow = {
        arrivalId: arrival.id,
        patientName: `${patient.givenNames} ${patient.familyName}`.trim(),
        waitingSince: arrival.arrivedAt.toISOString(),
        paperwork: paperworkFor({
          // "Done" IS THE SIGNATURE EVENT, not a status column: the event is a
          // link in the non-repudiation chain, and a status is something
          // somebody could set.
          signatureEventId: agreement?.signatureEventId ?? null,
          liveCaptureSession: agreementId ? liveByAgreement.has(agreementId) : false,
          agreementNeeded: this.agreementNeededFor({
            hasAgreement: Boolean(agreement),
            visitDecision: arrival.visitDecision,
            billingProviderNamed: arrival.affiliationId !== null,
            seeingBillingRole: seeingAffiliation?.billingRole ?? null,
          }),
        }),
        /*
         * WHOSE AGREEMENT IT IS, WHERE THAT IS SOMEBODY ELSE (§6a). *"'Dr
         * Chen's agreement — done' is honest; 'your agreement' would not be."*
         * Null whenever the agreement is anchored on the same person the
         * patient came to see, which is every ordinary GP visit — so a name
         * here always marks a real difference.
         */
        agreementProviderName:
          agreement?.affiliationId && agreement.affiliationId !== seeing
            ? (affiliationById.get(agreement.affiliationId)?.name ?? null)
            : null,
      };

      const key = seeing ?? '';
      const group = groups.get(key);
      if (group) group.rows.push(row);
      else {
        groups.set(key, {
          affiliationId: seeing,
          practitionerName: seeingAffiliation?.name ?? null,
          rows: [row],
        });
      }
    }

    return { scope, groups: [...groups.values()] satisfies WaitingGroup[] };
  }

  /**
   * DOES THIS VISIT NEED AN AGREEMENT AT ALL?
   *
   * ANSWERED FROM FACTS, NOT FROM THE POLICY TABLE'S RULE KEYS. The keys in
   * `visit-agreement-policy.json` are versioned content (hard rule 14), and a
   * switch on `already_covered_by_an_enduring_agreement` here would be a
   * second, unversioned copy of that mapping. These three facts stay true
   * whatever the table is edited to say next quarter, and the one content
   * question — "does a service by somebody in this role need a billing
   * provider at all" — is asked of the content itself through
   * `servicesNeedABillingProvider`.
   *
   * THE ORDER MATTERS, and the second and third are the pair
   * ARRIVAL-WHO-IS-SEEN.md §5 says a screen must never blur: a phlebotomist's
   * patient is FINISHED and a nurse's patient with no billing provider named
   * is WAITING, and both come back from the policy table as `none`.
   */
  private agreementNeededFor(facts: {
    hasAgreement: boolean;
    visitDecision: string | null;
    billingProviderNamed: boolean;
    seeingBillingRole: string | null;
  }): AgreementNeeded {
    // A draft exists, so the question is only whether it has been signed.
    if (facts.hasAgreement) return 'yes';

    /*
     * NOTHING DECIDED, OR SOMETHING DECIDED THAT HAS NOT BEEN DRAFTED YET.
     * "Not yet" is the honest answer and the safe one: it says work may be
     * outstanding, which is true, and it gates nothing.
     */
    if (facts.visitDecision !== 'none') return 'yes';

    // The phlebotomist's patient. No Medicare claim, so no benefit to assign
    // and nothing to sign — now or ever. Asked of the versioned content.
    if (facts.seeingBillingRole !== null && !servicesNeedABillingProvider(facts.seeingBillingRole)) return 'no';

    // The nurse's patient with nobody named to bill under. The visit needs a
    // claim and one field is missing, so something IS outstanding.
    if (!facts.billingProviderNamed) return 'yes';

    /*
     * WHAT IS LEFT: a visit that needs no NEW agreement because a signed,
     * stored one already covers it. That is "Done", and it is done — the
     * signature exists, it is simply not today's.
     */
    return 'covered_already';
  }

  /**
   * THE LAST AGREEMENT IN EACH CHAIN, walked FORWARD from the arrival's own.
   *
   * The desk walks BACKWARD, from a live row to the arrival that placed it in
   * the queue. This page holds the other end — an arrival — and needs the row
   * that is actually being signed. Bounded, so a cycle (impossible through the
   * one-successor index, cheap to rule out) cannot hang a practitioner's page.
   */
  private async newestInChain(
    tx: Parameters<Parameters<PrismaService['withPractice']>[1]>[0],
    agreementIds: string[],
  ): Promise<Map<string, string>> {
    const newest = new Map<string, string>(agreementIds.map((id) => [id, id]));
    let frontier = [...agreementIds];

    for (let hop = 0; hop < MAX_CHAIN_HOPS && frontier.length > 0; hop += 1) {
      const successors = await tx.agreement.findMany({
        where: { supersedesAgreementId: { in: frontier } },
        select: { id: true, supersedesAgreementId: true },
      });
      if (successors.length === 0) break;

      const byPredecessor = new Map(
        successors
          .filter((s): s is typeof s & { supersedesAgreementId: string } => s.supersedesAgreementId !== null)
          .map((s) => [s.supersedesAgreementId, s.id]),
      );
      for (const [origin, current] of newest) {
        const next = byPredecessor.get(current);
        if (next) newest.set(origin, next);
      }
      frontier = [...byPredecessor.values()];
    }

    return newest;
  }
}

function idsOf(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

function nameOf(practitioner: { givenNames: string; familyName: string } | undefined): string | null {
  return practitioner ? `${practitioner.givenNames} ${practitioner.familyName}`.trim() : null;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}
