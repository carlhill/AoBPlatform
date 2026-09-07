import { Global, Module } from '@nestjs/common';
import { ActingAsController } from './acting-as.controller';
import { ActingAsService } from './acting-as.service';
import { ActingAsInterceptor } from './acting-as.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Global, because the approval path has to be able to ask "did this person act
 * as this practice" without importing a module — and a separation-of-duties
 * check that some callers can skip is not a separation-of-duties check.
 */
@Global()
@Module({
  controllers: [ActingAsController],
  providers: [
    ActingAsService,
    /*
     * ORDER AGAINST AttributionInterceptor DOES NOT MATTER, and that is worth
     * saying because it looks as though it should. Attribution stamps the
     * OPERATOR's name; this one supplies the PRACTICE claim. They touch
     * different things on purpose — an acting-as session is a platform user
     * wearing a practice's face, and the name underneath is what goes in the
     * record.
     */
    { provide: APP_INTERCEPTOR, useClass: ActingAsInterceptor },
  ],
  exports: [ActingAsService],
})
export class ActingAsModule {}
