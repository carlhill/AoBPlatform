import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AbnError, AffiliationError, CeremonyError, DirectoryError } from '@aobplatform/domain';

/**
 * Maps domain rule violations to 400, globally.
 *
 * WHY THIS EXISTS RATHER THAN A try/catch AT EVERY CALL SITE: the domain
 * package throws typed errors carrying a rule id and a message written for the
 * person who hit it — "the directory is searched by AHPRA number only... ask
 * the practitioner for their AHPRA number; it is on their registration
 * certificate". Uncaught, Nest turns that into a bare 500 "Internal server
 * error" and the operator learns nothing. That happened: the directory guard
 * was working perfectly and the caller saw a 500.
 *
 * A missed try/catch is invisible until someone trips it. A filter cannot be
 * forgotten, so every rule added to the domain package from now on surfaces
 * properly by default.
 *
 * Note this does NOT swallow the distinction where it matters: call sites that
 * want a different status (403 for a REQ-PKI-01 ceremony failure, 409 for a
 * conflict) still catch and rethrow explicitly, and those run first.
 */
@Catch(AbnError, AffiliationError, CeremonyError, DirectoryError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: AbnError | AffiliationError | CeremonyError | DirectoryError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    this.logger.warn(`${exception.name} [${exception.rule}]: ${exception.message}`);
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      // The rule id travels with the message, so a support ticket can be
      // traced to the requirement that produced it.
      rule: exception.rule,
      message: exception.message,
      error: 'Bad Request',
    });
  }
}
