const testEnv = {
  BETTER_AUTH_SECRET: "test-secret",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/bap_test",
  REDIS_URL: "redis://localhost:6379",
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  SANDBOX_DEFAULT: "docker",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  APP_SERVER_SECRET: "test-server-secret",
  AWS_ENDPOINT_URL: "http://localhost:9000",
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] ??= value;
}
