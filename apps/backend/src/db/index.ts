import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const isProduction = process.env.NODE_ENV === 'production';

// Supabase requires SSL connection requirements in production
const client = postgres(process.env.DATABASE_URL!, {
  ...(isProduction ? { ssl: 'require' } : {})
});

export const db = drizzle(client, { schema });
