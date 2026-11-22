import { Router } from "express";
import { z } from "zod";
import { createUser } from "../repositories/userRepo";
import { listUserChats } from "../repositories/chatRepo";
import { id } from "./validation";

export const userRouter = Router();

// Helper endpoint so the API can be exercised end to end (users live in the relational DB).
userRouter.post("/users", async (req, res) => {
  const body = z
    .object({ username: z.string().trim().min(2).max(40), displayName: z.string().trim().max(80).optional() })
    .parse(req.body);
  res.status(201).json(await createUser(body.username, body.displayName));
});

// 6. List user chats
userRouter.get("/user/:userId/chats", async (req, res) => {
  const { userId } = z.object({ userId: id }).parse(req.params);
  res.json({ chats: await listUserChats(userId) });
});
