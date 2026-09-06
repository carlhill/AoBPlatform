import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ArtefactsModule } from '../artefacts/artefacts.module';
import { PracticesController } from './practices.controller';
import { PracticesService } from './practices.service';
import { PracticeUsersController } from './practice-users.controller';
import { PracticeUsersService } from './practice-users.service';
import { LetterheadController } from './letterhead.controller';
import { LetterheadService } from './letterhead.service';

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
  providers: [PracticesService, PracticeUsersService, LetterheadService],
  // LetterheadService is exported because the LOCK reads it: every agreement
  // is rendered onto the practice's letterhead, and the fields come from the
  // practice record rather than from a second copy.
  exports: [PracticesService, LetterheadService],
})
export class PracticesModule {}
