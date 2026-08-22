import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AttributionInterceptor } from './attribution.interceptor';

@Global()
@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    /*
     * ORDER MATTERS AND IS NOT ACCIDENTAL. Guards run before interceptors, so
     * AuthGuard has already verified the token and attached `request.principal`
     * by the time this reads it. Registered the other way round it would see no
     * principal and silently do nothing — the worst kind of failure, because
     * every screen would look fine and every audit record would carry whatever
     * the caller typed.
     */
    { provide: APP_INTERCEPTOR, useClass: AttributionInterceptor },
  ],
})
export class AuthModule {}
