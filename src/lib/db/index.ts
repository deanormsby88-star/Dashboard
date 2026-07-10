import { Pool } from "pg";
import { getEnv } from "@/lib/env";

// Reuse the pool across hot reloads in dev and across route invocations in
// serverless. Supabase's connection pooler (port 6543) is recommended for
// Vercel deployments — see README.
const globalForDb = globalThis as unknown as { deanosPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.deanosPool) {
    globalForDb.deanosPool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 5,
    });
  }
  return globalForDb.deanosPool;
}
