import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_TOKEN_COOKIE } from './auth/access-token-cookie.js';

const COOKIE_SECURITY_SCHEME = 'cookie';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('RAG-ATS API')
    .setDescription(
      'Log in via POST /auth/login below ("Try it out") first. The browser ' +
        'stores the resulting httpOnly access_token cookie and sends it on ' +
        'every later request made from this page automatically. The ' +
        "Authorize button can't set the cookie itself because it's httpOnly.",
    )
    .setVersion('1.0')
    .addCookieAuth(ACCESS_TOKEN_COOKIE, undefined, COOKIE_SECURITY_SCHEME)
    .addSecurityRequirements(COOKIE_SECURITY_SCHEME)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });
}
