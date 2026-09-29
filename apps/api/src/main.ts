import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.setup.js';
import { AppModule } from './app.module.js';
import { EnvConfig } from './config/env.config.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  if (app.get(EnvConfig).NODE_ENV !== 'production') {
    setupSwagger(app);
  }
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
