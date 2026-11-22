import { readFileSync } from "fs";
import path from "path";
import { pool } from "./pool";

async function main(): Promise<void> {
  const sql = readFileSync(path.resolve(__dirname, "../../sql/schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Migration complete");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
