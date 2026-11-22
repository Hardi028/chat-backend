import { PoolClient } from "pg";
import { pool, withTx } from "../db/pool";
import { badRequest, forbidden, notFound } from "../errors";
import { assertUsersExist } from "./userRepo";

export interface ChatRecord {
  id: string;
  type: "direct" | "group";
  name: string | null;
  memberIds: string[];
  createdAt: string;
  lastMessageAt: string | null;
}

interface ChatRow {
  id: string;
  type: "direct" | "group";
  name: string | null;
  created_at: Date;
  last_message_at: Date | null;
  member_ids: string[];
}

const CHAT_SELECT = `
  SELECT c.id::text AS id, c.type, c.name, c.created_at, c.last_message_at,
         ARRAY(SELECT user_id::text FROM chat_members
               WHERE chat_id = c.id ORDER BY joined_at, user_id)::text[] AS member_ids
  FROM chats c`;

const toRecord = (r: ChatRow): ChatRecord => ({
  id: r.id,
  type: r.type,
  name: r.name,
  memberIds: r.member_ids,
  createdAt: r.created_at.toISOString(),
  lastMessageAt: r.last_message_at ? r.last_message_at.toISOString() : null,
});

export async function getChatById(chatId: string): Promise<ChatRecord> {
  const { rows } = await pool.query<ChatRow>(`${CHAT_SELECT} WHERE c.id = $1`, [chatId]);
  if (rows.length === 0) throw notFound("Chat");
  return toRecord(rows[0]);
}

/** Throws 404 if chat doesn't exist, 403 if user is not a member. */
export async function assertMember(chatId: string, userId: string): Promise<void> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId]
  );
  if (rowCount && rowCount > 0) return;
  const chat = await pool.query("SELECT 1 FROM chats WHERE id = $1", [chatId]);
  if (chat.rowCount === 0) throw notFound("Chat");
  throw forbidden("User is not a member of this chat");
}

export async function getOrCreateDirectChat(
  userAId: string,
  userBId: string
): Promise<{ chat: ChatRecord; created: boolean }> {
  if (userAId === userBId) throw badRequest("Cannot create a chat with yourself");
  await assertUsersExist([userAId, userBId]);

  const [lo, hi] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  const key = `${lo}:${hi}`;

  const { chatId, created } = await withTx(async (client: PoolClient) => {
    // The UNIQUE(direct_key) constraint makes this race-safe under concurrent requests.
    const ins = await client.query<{ id: string }>(
      `INSERT INTO chats (type, direct_key, created_by) VALUES ('direct', $1, $2)
       ON CONFLICT (direct_key) DO NOTHING RETURNING id::text AS id`,
      [key, userAId]
    );
    if (ins.rowCount === 1) {
      const id = ins.rows[0].id;
      await client.query("INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3)", [id, lo, hi]);
      return { chatId: id, created: true };
    }
    const existing = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM chats WHERE direct_key = $1",
      [key]
    );
    return { chatId: existing.rows[0].id, created: false };
  });

  return { chat: await getChatById(chatId), created };
}

export async function listUserChats(userId: string): Promise<ChatRecord[]> {
  const { rows } = await pool.query<ChatRow>(
    `${CHAT_SELECT}
     JOIN chat_members m ON m.chat_id = c.id
     WHERE m.user_id = $1
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    [userId]
  );
  return rows.map(toRecord);
}

export async function touchLastMessage(chatId: string, at: Date): Promise<void> {
  await pool.query(
    "UPDATE chats SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2) WHERE id = $1",
    [chatId, at]
  );
}

/* ------------------------- Group chats (bonus) ------------------------- */

export async function createGroupChat(creatorId: string, name: string, memberIds: string[]): Promise<ChatRecord> {
  const members = [...new Set([creatorId, ...memberIds])];
  await assertUsersExist(members);

  const chatId = await withTx(async (client) => {
    const ins = await client.query<{ id: string }>(
      "INSERT INTO chats (type, name, created_by) VALUES ('group', $1, $2) RETURNING id::text AS id",
      [name, creatorId]
    );
    const id = ins.rows[0].id;
    for (const uid of members) {
      await client.query("INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)", [
        id,
        uid,
        uid === creatorId ? "admin" : "member",
      ]);
    }
    return id;
  });
  return getChatById(chatId);
}

async function requireGroupAdmin(chatId: string, userId: string): Promise<void> {
  const chat = await getChatById(chatId);
  if (chat.type !== "group") throw badRequest("Members can only be managed on group chats");
  const { rows } = await pool.query<{ role: string }>(
    "SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId]
  );
  if (rows.length === 0) throw forbidden("User is not a member of this chat");
  if (rows[0].role !== "admin") throw forbidden("Only group admins can do this");
}

export async function addGroupMembers(chatId: string, requesterId: string, userIds: string[]): Promise<ChatRecord> {
  await requireGroupAdmin(chatId, requesterId);
  await assertUsersExist(userIds);
  for (const uid of new Set(userIds)) {
    await pool.query(
      "INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [chatId, uid]
    );
  }
  return getChatById(chatId);
}

/** Admins can remove anyone; any member can remove themselves (leave). */
export async function removeGroupMember(chatId: string, requesterId: string, targetId: string): Promise<ChatRecord> {
  if (requesterId === targetId) {
    const chat = await getChatById(chatId);
    if (chat.type !== "group") throw badRequest("Cannot leave a direct chat");
    await assertMember(chatId, requesterId);
  } else {
    await requireGroupAdmin(chatId, requesterId);
  }

  const del = await pool.query("DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2", [chatId, targetId]);
  if (del.rowCount === 0) throw notFound("Member");

  // Keep the group administrable: promote the longest-standing member if no admin remains.
  await pool.query(
    `UPDATE chat_members SET role = 'admin'
     WHERE chat_id = $1 AND user_id = (
       SELECT user_id FROM chat_members WHERE chat_id = $1 ORDER BY joined_at, user_id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM chat_members WHERE chat_id = $1 AND role = 'admin')`,
    [chatId]
  );
  return getChatById(chatId);
}
