import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL || '';
const needsSsl = isProduction || dbUrl.includes('supabase') || dbUrl.includes('railway');

// Connection pooling configuration optimized for Railway & Supabase PostgreSQL
export const client = postgres(dbUrl, {
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
  idle_timeout: 30,
  connect_timeout: 15,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const db = drizzle(client, { schema });
