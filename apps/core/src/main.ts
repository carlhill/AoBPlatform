import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { MAX_ARTEFACT_BYTES } from '@aobplatform/domain';
import { AppModule } from './app.module';

/**
 * The JSON body limit, derived from the artefact rule rather than guessed.
 *
 * Nest's default is 100 KB. The artefact rule permits 20 MB, and evidence is
 * posted as base64 inside JSON — so the server was refusing at one two-hundredth
 * of what the screen promised, with Express's own "request entity too large"
 * and no mention of a size anyone could act on.
 *
 * Base64 inflates by 4/3, plus the surrounding JSON, so the ceiling is derived
 * from MAX_ARTEFACT_BYTES instead of written as a number that would drift the
 * first time the artefact rule moved.
 */
const JSON_BODY_LIMIT = Math.ceil((MAX_ARTEFACT_BYTES * 4) / 3) + 1024 * 1024;

/**
 * CORS, WITH CREDENTIALS -- for the patient portal's cookie (4 Sep 2026).
 *
 * `cors: true` answered `Access-Control-Allow-Origin: *`, which a browser
 * refuses to pair with `credentials: 'include'`; the portal is the first
 * surface that authenticates with a cookie rather than a header, and every
 * one of its requests failed in the browser while passing from curl. The
 * allowed origins are an explicit list (`CORS_ORIGINS`, comma-separated),
 * defaulting to the local Next dev server; a wildcard is never reflected.
 */
function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3100')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: { origin: corsOrigins(), credentials: true },
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Raised for artefact uploads specifically. Everything else this API accepts
  // is small, so the limit is not doing much work elsewhere — but a limit that
  // contradicts the documented rule is worse than a generous one.
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  // OpenAPI contract (definition of done, CLAUDE.md §6) — UI at /openapi,
  // machine contract at /openapi.json.
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('AoBPlatform core').setVersion('0.1.0').build(),
  );
  SwaggerModule.setup('openapi', app, document, { jsonDocumentUrl: 'openapi.json' });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[core] listening on :${port}`);
}

bootstrap();
