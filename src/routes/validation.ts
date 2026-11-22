import { z } from "zod";

export const id = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());

export const messageText = z.string().trim().min(1, "text must not be empty").max(4000);
