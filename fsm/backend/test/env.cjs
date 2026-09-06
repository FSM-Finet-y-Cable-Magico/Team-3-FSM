// Se ejecuta antes de importar AppModule. Nunca reutiliza variables remotas.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://fsm_test:fsm_test@127.0.0.1:1/fsm_isolated',
  JWT_SECRET: 'team3-local-tests-only',
  JWT_EXPIRES_IN: '8h',
  FRONTEND_URL: 'http://127.0.0.1:5173',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  SEED_ADMIN_PASSWORD: '',
});
