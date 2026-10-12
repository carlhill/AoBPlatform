import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IdentityModule } from '../identity/identity.module';
import { ArtefactsModule } from '../artefacts/artefacts.module';
import { PracticesController } from './practices.controller';
import { PracticesService } from './practices.service';
import { PracticeUsersController } from './practice-users.controller';
import { PracticeUsersService } from './practice-users.service';
import { LetterheadController } from './letterhead.controller';
import { LetterheadService } from './letterhead.service';
import { PracticeSurfacesService } from './practice-surfaces.service';
import { SurfaceGuard } from './surface.guard';

@Module({
  // For KEYCLOAK_ADMIN: inviting somebody creates their account and sends
  // the enrolment link, which is the identity layer's job rather than ours.
  // ArtefactsModule, not the artefacts table: the letterhead logo is stored,
  // hashed and vault-evented through the service that already does that for
  // every other piece of evidence (CLAUDE.md §4).
  imports: [IdentityModule, ArtefactsModule],
  // LETTERHEAD FIRST. Nest registers routes in controller order, and
  // PracticesController's `GET :id` (ParseUUIDPipe) otherwise swallows
  // `GET /practices/letterhead` as an id -- Carl saw 'Validation failed (uuid
  // is expected)' on /practice/templates (7 Sep 2026).
  controllers: [LetterheadController, PracticesController, PracticeUsersController],
  providers: [
    PracticesService,
    PracticeUsersService,
    LetterheadService,
    PracticeSurfacesService,
    /*
     * WHICH PARTS OF AoB THIS PRACTICE USES (D-2026-09-14-04), enforced on
     * every route rather than on two special cases.
     *
     * REGISTERED HERE, AND THE MODULE ORDER IS LOAD-BEARING. Nest runs global
     * guards in module-registration order and `AppModule` lists
     * `PracticesModule` after both `AuthModule` and `DevicesModule` — so the
     * token's practice claim is already on the request, and on a `/kiosk`
     * route the device guard has already deleted whatever `x-practice-id` the
     * caller sent and replaced it with the practice the credential actually
     * resolves to. Registered earlier, a tablet could name any practice it
     * liked and pick a profile that allowed what it wanted.
     */
    { provide: APP_GUARD, useClass: SurfaceGuard },
  ],
  // LetterheadService is exported because the LOCK reads it: every agreement
  // is rendered onto the practice's letterhead, and the fields come from the
  // practice record rather than from a second copy.
  exports: [PracticesService, LetterheadService],
})
export class PracticesModule {}
