import { pool } from "../db/pool";
import { badRequest, conflict } from "../errors";

export interface UserRecord {
  id: string;
  username: string;
  displayName: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  created_at: Date;
}

export async function createUser(username: string, displayName?: string): Promise<UserRecord> {
  try {
    const { rows } = await pool.query<UserRow>(
      "INSERT INTO users (username, display_name) VALUES ($1, $2) RETURNING id, username, display_name, created_at",
      [username, displayName ?? null]
    );
    const r = rows[0];
    return { id: r.id, username: r.username, displayName: r.display_name, createdAt: r.created_at.toISOString() };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw conflict("Username already taken");
    throw err;
  }
}

export async function assertUsersExist(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id::text AS id FROM users WHERE id = ANY($1::uuid[])",
    [unique]
  );
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    throw badRequest(`Unknown user id(s): ${missing.join(", ")}`);
  }
}
