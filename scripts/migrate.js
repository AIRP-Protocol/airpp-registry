#!/usr/bin/env node
// scripts/migrate.js — apply numbered migrations in order, idempotent
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "../src/lib/config.js";

if (!config.databaseUrl) {
  console.log("No DATABASE_URL — skipping migration (in-memory mode).");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: config.databaseUrl });

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      "SELECT id FROM _migrations WHERE filename = $1", [file]
    );
    if (rows.length > 0) {
      console.log(`  skip  ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
      console.log(`  apply ${file}`);
    } catch (err) {
      console.error(`  ERROR applying ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log("Migrations complete.");
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
