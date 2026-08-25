try {
  const existingEnv = { ...process.env };
  process.loadEnvFile();
  Object.assign(process.env, existingEnv);
} catch {
  // In production environments (Docker/Render/Railway), env vars are provided directly via process.env
}

export {};
