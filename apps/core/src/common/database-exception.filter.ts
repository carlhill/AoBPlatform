import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Turns a database refusal into an answer the operator can act on.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: a great deal of this system's meaning
 * lives in CHECK constraints and RAISE EXCEPTION messages — approval requires
 * an entitlement check, a phone check must record where the number came from,
 * a manager must be a different person, a ceremony must be complete for its
 * kind. Those messages are written for humans and say exactly what to do.
 *
 * Uncaught, every one of them reached the caller as `500 Internal server
 * error`. The rule fired, the write was correctly refused, and the person on
 * the other end learned nothing — so the enforcement was invisible and looked
 * like a bug in the platform rather than a deliberate refusal.
 *
 * Only DELIBERATE refusals are passed through: check-constraint violations
 * (23514), unique violations (23505), foreign-key violations (23503) and
 * explicit RAISE EXCEPTION (P0001). Anything else stays a 500 with no detail,
 * because an unexpected database error may carry internals that are nobody's
 * business.
 */

/** Postgres SQLSTATE classes we deliberately author messages for. */
const DELIBERATE_REFUSALS: Record<string, HttpStatus> = {
  '23514': HttpStatus.BAD_REQUEST, // check_violation
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.BAD_REQUEST, // foreign_key_violation
  P0001: HttpStatus.BAD_REQUEST, // raise_exception
};

/**
 * Postgres reports a constraint failure with the constraint NAME and a DETAIL
 * line that echoes the whole failing row. The row may carry practice data, so
 * it never goes to the client — only the first line, plus the constraint name,
 * which we choose and which is meant to be read.
 */
function humanise(raw: string): string {
  const firstLine = raw.split('\n')[0].replace(/^ERROR:\s*/, '').trim();
  const constraint = /violates check constraint "([^"]+)"/.exec(raw)?.[1];
  if (constraint) {
    return `${firstLine} (${constraint})`;
  }
  return firstLine;
}

@Catch(Prisma.PrismaClientKnownRequestError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // Raw queries surface the underlying error inside meta; the typed client
    // reports the SQLSTATE directly on `code`.
    const meta = (exception.meta ?? {}) as { code?: string; message?: string };
    const sqlState = meta.code ?? exception.code;
    const raw = meta.message ?? exception.message;

    const status = DELIBERATE_REFUSALS[sqlState ?? ''];
    if (!status) {
      this.logger.error(`Unhandled database error ${exception.code}: ${exception.message}`);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
      return;
    }

    const message = humanise(raw);
    this.logger.warn(`Refused by the database (${sqlState}): ${message}`);
    response.status(status).json({
      statusCode: status,
      sqlState,
      message,
      error: status === HttpStatus.CONFLICT ? 'Conflict' : 'Bad Request',
    });
  }
}
