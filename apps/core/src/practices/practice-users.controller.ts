import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { CONSOLE_ROLES, MAX_PASSKEYS_PER_ADMIN, MAX_USERS_PER_SCOPE } from '@aobplatform/domain';
import { PracticeUsersService } from './practice-users.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';

export class GrantAccessDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsIn(CONSOLE_ROLES as unknown as string[])
  consoleRole!: string;

  /** What they do at the practice. Separate from what they may do here. */
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class ChangeRoleDto {
  @IsIn(CONSOLE_ROLES as unknown as string[])
  consoleRole!: string;
}

export class DeactivateDto {
  /** Required. The practice reads this when deciding whether to restore them. */
  @IsString()
  @MinLength(1)
  reason!: string;
}

/**
 * A practice managing its own people.
 *
 * @PracticeScoped THROUGHOUT, and that is the whole access model: deciding who
 * may use a practice's console is the practice's own act. A platform operator
 * gets here only by acting as the practice, which carries its own cost
 * (CRITICAL-ISSUES §5 rules 6 and 7).
 *
 * The caps, the single administrator account and the inactivity lifecycle all
 * live in packages/domain/src/practice-users.ts with tests. Nothing here
 * decides anything — it wires a screen to rules that already exist.
 */
@Controller('practice-users')
export class PracticeUsersController {
  constructor(private readonly users: PracticeUsersService) {}

  @Get()
  list(
    @Headers('x-practice-id') practiceId: string | undefined,
    @SessionActor() actor: Actor | undefined,
  ) {
    // The caller goes in so the response can say whether they may change any
    // of it. The screen hides exactly what the API would refuse.
    return this.users.list(practiceId ?? '', actor);
  }

  @PracticeScoped()
  @Post()
  grant(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: GrantAccessDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.users.grant(practiceId ?? '', dto, actor);
  }

  /**
   * Send the enrolment link. A PRACTICE task, like the other invitations —
   * @PracticeScoped means a platform operator cannot do it from the outside,
   * but can while acting as somebody at the practice, because acting-as
   * carries a practice claim.
   */
  @PracticeScoped()
  @Post(':staffId/invite')
  invite(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.users.invite(practiceId ?? '', staffId, actor);
  }

  @PracticeScoped()
  @Post(':staffId/role')
  changeRole(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: ChangeRoleDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.users.changeRole(practiceId ?? '', staffId, dto.consoleRole, actor);
  }

  /** Withdraws access. NEVER deletes — somebody who approved something stays identifiable. */
  @PracticeScoped()
  @Post(':staffId/deactivate')
  deactivate(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: DeactivateDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.users.deactivate(practiceId ?? '', staffId, dto.reason, actor);
  }

  @PracticeScoped()
  @Post(':staffId/reactivate')
  reactivate(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.users.reactivate(practiceId ?? '', staffId, actor);
  }

  /** The limits, so the screen shows the same numbers the server enforces. */
  @Get('catalogue')
  catalogue() {
    return {
      roles: CONSOLE_ROLES,
      maxPerScope: MAX_USERS_PER_SCOPE,
      maxPasskeys: MAX_PASSKEYS_PER_ADMIN,
    };
  }
}
