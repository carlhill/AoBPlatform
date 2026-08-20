import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

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
