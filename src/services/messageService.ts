import { DocumentSnapshot, FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebase";
import { assertMember, touchLastMessage } from "../repositories/chatRepo";
import { badRequest, conflict, forbidden, notFound } from "../errors";

/*
 * Firestore layout
 *   chats/{chatId}/messages/{messageId}
 *       { senderId, text, createdAt, editedAt, deleted, deletedAt, readBy: { [userId]: Timestamp } }
 *   chats/{chatId}/lastSeen/{userId}
 *       { userId, messageId, updatedAt }
 */

interface MessageDoc {
  senderId: string;
  text: string | null;
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
  deleted: boolean;
  readBy?: Record<string, Timestamp>;
}

export interface MessageDto {
  id: string;
  chatId: string;
  senderId: string;
  text: string | null;
  createdAt: string | null;
  editedAt: string | null;
  deleted: boolean;
  readBy: Record<string, string>;
}

export interface LastSeenDto {
  chatId: string;
  userId: string;
  messageId: string;
  updatedAt: string | null;
}

const messagesCol = (chatId: string) => db.collection("chats").doc(chatId).collection("messages");
const lastSeenCol = (chatId: string) => db.collection("chats").doc(chatId).collection("lastSeen");

const iso = (t: unknown): string | null => (t instanceof Timestamp ? t.toDate().toISOString() : null);

function toDto(chatId: string, snap: DocumentSnapshot): MessageDto {
  const d = snap.data() as MessageDoc;
  const readBy: Record<string, string> = {};
  for (const [uid, ts] of Object.entries(d.readBy ?? {})) {
    const v = iso(ts);
    if (v) readBy[uid] = v;
  }
  return {
    id: snap.id,
    chatId,
    senderId: d.senderId,
    text: d.text,
    createdAt: iso(d.createdAt),
    editedAt: iso(d.editedAt),
    deleted: d.deleted,
    readBy,
  };
}

export async function sendMessage(chatId: string, senderId: string, text: string): Promise<MessageDto> {
  await assertMember(chatId, senderId);

  const ref = messagesCol(chatId).doc();
  await ref.set({
    senderId,
    text,
    createdAt: FieldValue.serverTimestamp(), // server-side time => consistent ordering across clients
    editedAt: null,
    deleted: false,
    readBy: {},
  });

  const dto = toDto(chatId, await ref.get());

  // Denormalised sort key for the chat list. Best effort: the message is already durable.
  if (dto.createdAt) {
    touchLastMessage(chatId, new Date(dto.createdAt)).catch((err) =>
      console.error("Failed to update last_message_at", err)
    );
  }
  return dto;
}

export async function getMessages(
  chatId: string,
  limit: number,
  before?: Date,
  requesterId?: string
): Promise<MessageDto[]> {
  if (requesterId) await assertMember(chatId, requesterId);

  let q = messagesCol(chatId).orderBy("createdAt", "desc").limit(limit);
  if (before) q = q.startAfter(Timestamp.fromDate(before));

  const snap = await q.get();
  // Fetched newest-first so `limit` returns the latest N; flip to chronological order.
  return snap.docs.map((d) => toDto(chatId, d)).reverse();
}

export async function markRead(chatId: string, messageId: string, userId: string): Promise<MessageDto> {
  await assertMember(chatId, userId);
  const ref = messagesCol(chatId).doc(messageId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Message");
    const d = snap.data() as MessageDoc;
    if (d.senderId === userId) throw badRequest("Cannot mark your own message as read");
    if (d.readBy?.[userId]) return; // idempotent
    tx.update(ref, new FieldPath("readBy", userId), FieldValue.serverTimestamp());
  });

  return toDto(chatId, await ref.get());
}

export async function updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenDto> {
  await assertMember(chatId, userId);
  const msgRef = messagesCol(chatId).doc(messageId);
  const seenRef = lastSeenCol(chatId).doc(userId);

  await db.runTransaction(async (tx) => {
    const msgSnap = await tx.get(msgRef);
    if (!msgSnap.exists) throw notFound("Message");
    const curSnap = await tx.get(seenRef);

    // Never move the marker backwards (e.g. out-of-order requests from multiple devices).
    if (curSnap.exists) {
      const curMsg = await tx.get(messagesCol(chatId).doc(curSnap.get("messageId") as string));
      const curTs: unknown = curMsg.get("createdAt");
      const newTs: unknown = msgSnap.get("createdAt");
      if (curTs instanceof Timestamp && newTs instanceof Timestamp && newTs.toMillis() < curTs.toMillis()) return;
    }
    tx.set(seenRef, { userId, messageId, updatedAt: FieldValue.serverTimestamp() });
  });

  const result = await seenRef.get();
  return {
    chatId,
    userId,
    messageId: result.get("messageId") as string,
    updatedAt: iso(result.get("updatedAt")),
  };
}

export async function getLastSeen(chatId: string, requesterId: string): Promise<LastSeenDto[]> {
  await assertMember(chatId, requesterId);
  const snap = await lastSeenCol(chatId).get();
  return snap.docs.map((d) => ({
    chatId,
    userId: d.id,
    messageId: d.get("messageId") as string,
    updatedAt: iso(d.get("updatedAt")),
  }));
}

/* ------------------------- Edit / delete (bonus) ------------------------- */

export async function editMessage(
  chatId: string,
  messageId: string,
  userId: string,
  text: string
): Promise<MessageDto> {
  await assertMember(chatId, userId);
  const ref = messagesCol(chatId).doc(messageId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Message");
    const d = snap.data() as MessageDoc;
    if (d.senderId !== userId) throw forbidden("Only the sender can edit a message");
    if (d.deleted) throw conflict("Message has been deleted");
    tx.update(ref, { text, editedAt: FieldValue.serverTimestamp() });
  });

  return toDto(chatId, await ref.get());
}

/** Soft delete: keeps the document so ordering and read receipts stay intact. */
export async function deleteMessage(chatId: string, messageId: string, userId: string): Promise<MessageDto> {
  await assertMember(chatId, userId);
  const ref = messagesCol(chatId).doc(messageId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Message");
    const d = snap.data() as MessageDoc;
    if (d.senderId !== userId) throw forbidden("Only the sender can delete a message");
    if (d.deleted) return;
    tx.update(ref, { text: null, deleted: true, deletedAt: FieldValue.serverTimestamp() });
  });

  return toDto(chatId, await ref.get());
}
