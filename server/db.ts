import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Copie .env.example para .env");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
});

pool.on("connect", (client) => {
  client
    .query("SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000")
    .catch((err) => console.error("[db] timeouts:", err?.message));
});

pool.on("error", (err) => {
  console.error("[db] idle pool error (recovered):", err?.message);
});

export const db = drizzle(pool, { schema });
