import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "db", "booking.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

export function migrate(): void {
  db.exec(fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf-8"));
}
