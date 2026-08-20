import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ENDPOINT = 'aob:public-endpoint';

/**
 * Marks an endpoint reachable without an account. Used ONLY for the patient
 * capture-link surfaces: portal access must never be a precondition of
 * signing (REQ-PORT-08), and those endpoints are protected by a single-use,
 * non-enumerable token plus bot/velocity controls instead.
 */
export const Public = () => SetMetadata(PUBLIC_ENDPOINT, true);
