// ConfigModule.forRoot({ validationSchema }) validates process.env as soon as
// AppModule is imported (it's evaluated while building the @Module()
// decorator's metadata, not lazily at DI-resolution time) - so these must be
// set here, in a Jest setupFiles script that runs before any test file's own
// `import { AppModule }` chain, not inside a function called later.
process.env.DATABASE_URL ??=
  'postgres://test:test@localhost:5432/unused_placeholder';
process.env.JWT_SECRET ??= 'test-secret';
process.env.JWT_EXPIRES_IN ??= '1h';
process.env.PORT ??= '0';
process.env.NODE_ENV ??= 'test';
