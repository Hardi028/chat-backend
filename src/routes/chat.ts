import { Router } from "express";
import { z } from "zod";
import * as chats from "../repositories/chatRepo";
import * as messages from "../services/messageService";
import { id, messageText } from "./validation";

export const chatRouter = Router();

const messageParams = z.object({ chatId: id, messageId: z.string().min(1) });

// 1. Create or get 1:1 chat
chatRouter.post("/chat/create", async (req, res) => {
  const { userAId, userBId } = z.object({ userAId: id, userBId: id }).parse(req.body);
  const { chat, created } = await chats.getOrCreateDirectChat(userAId, userBId);
  res.status(created ? 201 : 200).json({ chatId: chat.id, created });
});

// 2. Send message
chatRouter.post("/chat/:chatId/message/send", async (req, res) => {
  const { chatId } = z.object({ chatId: id }).parse(req.params);
  const { senderId, text } = z.object({ senderId: id, text: messageText }).parse(req.body);
  res.status(201).json(await messages.sendMessage(chatId, senderId, text));
});

// 3. Get messages (ascending by timestamp). Optional: ?before=<ISO>&userId=<uuid>
chatRouter.get("/chat/:chatId/messages", async (req, res) => {
  const { chatId } = z.object({ chatId: id }).parse(req.params);
  const q = z
    .object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      before: z.coerce.date().optional(),
      userId: id.optional(),
    })
    .parse(req.query);
  res.json({ messages: await messages.getMessages(chatId, q.limit, q.before, q.userId) });
});

// 4. Mark message read
chatRouter.post("/chat/:chatId/message/:messageId/read", async (req, res) => {
  const { chatId, messageId } = messageParams.parse(req.params);
  const { userId } = z.object({ userId: id }).parse(req.body);
  res.json(await messages.markRead(chatId, messageId, userId));
});

// 5. Update last seen message
chatRouter.post("/chat/:chatId/lastseen", async (req, res) => {
  const { chatId } = z.object({ chatId: id }).parse(req.params);
  const { userId, messageId } = z.object({ userId: id, messageId: z.string().min(1) }).parse(req.body);
  res.json(await messages.updateLastSeen(chatId, userId, messageId));
});

// Extra: read everyone's last-seen markers for a chat
chatRouter.get("/chat/:chatId/lastseen", async (req, res) => {
  const { chatId } = z.object({ chatId: id }).parse(req.params);
  const { userId } = z.object({ userId: id }).parse(req.query);
  res.json({ lastSeen: await messages.getLastSeen(chatId, userId) });
});

/* ---------------------------- Bonus: edit/delete ---------------------------- */

chatRouter.patch("/chat/:chatId/message/:messageId", async (req, res) => {
  const { chatId, messageId } = messageParams.parse(req.params);
  const { userId, text } = z.object({ userId: id, text: messageText }).parse(req.body);
  res.json(await messages.editMessage(chatId, messageId, userId, text));
});

chatRouter.delete("/chat/:chatId/message/:messageId", async (req, res) => {
  const { chatId, messageId } = messageParams.parse(req.params);
  const { userId } = z.object({ userId: id }).parse(req.body);
  res.json(await messages.deleteMessage(chatId, messageId, userId));
});

/* ---------------------------- Bonus: group chats ---------------------------- */

chatRouter.post("/chat/group", async (req, res) => {
  const body = z
    .object({ creatorId: id, name: z.string().trim().min(1).max(100), memberIds: z.array(id).min(1).max(255) })
    .parse(req.body);
  res.status(201).json(await chats.createGroupChat(body.creatorId, body.name, body.memberIds));
});

chatRouter.get("/chat/:chatId", async (req, res) => {
  const { chatId } = z.object({ chatId: id }).parse(req.params);
  res.json(await chats.getChatById(chatId));
});

chatRouter.post("/chat/:chatId/members", async (req, res) => {
  const { chatId } = z.object({ chatId: id }).parse(req.params);
  const { requesterId, userIds } = z.object({ requesterId: id, userIds: z.array(id).min(1) }).parse(req.body);
  res.json(await chats.addGroupMembers(chatId, requesterId, userIds));
});

chatRouter.delete("/chat/:chatId/members/:userId", async (req, res) => {
  const { chatId, userId } = z.object({ chatId: id, userId: id }).parse(req.params);
  const { requesterId } = z.object({ requesterId: id }).parse(req.body);
  res.json(await chats.removeGroupMember(chatId, requesterId, userId));
});
