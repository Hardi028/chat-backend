# Chat Backend (Node.js + TypeScript + PostgreSQL + Firestore)

- **PostgreSQL** – users, chats, chat membership (source of truth for _who is in which chat_)
- **Firestore** – messages, read receipts, last-seen markers

## Quick start

```bash
cp .env.example .env
docker compose up -d        # Postgres :5432 + Firestore emulator :8085
npm install
npm run migrate             # creates tables
npm run dev                 # http://localhost:3000
```

The `chat`/`chat` database credentials in `.env.example` are for the PostgreSQL
container started by Docker Compose. If you use an existing local PostgreSQL
instead, set `DATABASE_URL` in `.env` to that server's username, password, and
an existing database, for example:

```text
DATABASE_URL=postgres://postgres:<your-password>@localhost:5432/chat
```

Keep the real password in your local `.env`; do not commit it.

If PostgreSQL is already running locally, start only the Firestore emulator with
`docker compose up -d firestore` to avoid binding the Compose PostgreSQL service
to the same host port.

Production: unset `FIRESTORE_EMULATOR_HOST`, set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key, then `npm run build && npm run migrate:prod && npm start`.

## Data model

**Postgres** (`sql/schema.sql`): `users`, `chats` (`type` = direct|group, unique `direct_key` = sorted `"idA:idB"` so a pair can only ever have one 1:1 chat, even under concurrent requests), `chat_members` (with `role`).

**Firestore**

```
chats/{chatId}/messages/{messageId}  { senderId, text, createdAt, editedAt, deleted, readBy: {userId: ts} }
chats/{chatId}/lastSeen/{userId}     { userId, messageId, updatedAt }
```

Design notes:

- `createdAt` is a **server timestamp**, so ordering doesn't depend on client clocks.
- Read receipts live on the message (`readBy` map) so a page of messages returns its receipts with no extra reads.
- Marking read is a transaction and idempotent; last-seen never moves backwards.
- Every message operation checks chat membership against Postgres.
- `chats.last_message_at` is a denormalised sort key so `GET /user/:id/chats` is ordered by recent activity.

## API

| #   | Method & path                                             | Body / query                               |
| --- | --------------------------------------------------------- | ------------------------------------------ |
| –   | `POST /users` (helper)                                    | `{username, displayName?}`                 |
| 1   | `POST /chat/create`                                       | `{userAId, userBId}` → `{chatId, created}` |
| 2   | `POST /chat/:chatId/message/send`                         | `{senderId, text}`                         |
| 3   | `GET /chat/:chatId/messages?limit=50`                     | optional `before=<ISO>`, `userId=<uuid>`   |
| 4   | `POST /chat/:chatId/message/:messageId/read`              | `{userId}`                                 |
| 5   | `POST /chat/:chatId/lastseen`                             | `{userId, messageId}`                      |
| 6   | `GET /user/:userId/chats`                                 | → chats with `memberIds`                   |
| B   | `PATCH /chat/:chatId/message/:messageId`                  | `{userId, text}` (sender only)             |
| B   | `DELETE /chat/:chatId/message/:messageId`                 | `{userId}` (soft delete, sender only)      |
| B   | `POST /chat/group`                                        | `{creatorId, name, memberIds[]}`           |
| B   | `POST /chat/:chatId/members`                              | `{requesterId, userIds[]}` (admin)         |
| B   | `DELETE /chat/:chatId/members/:userId`                    | `{requesterId}` (admin, or self to leave)  |
| B   | `GET /chat/:chatId`, `GET /chat/:chatId/lastseen?userId=` |                                            |

Errors: `{ "error": { "code", "message", "details?" } }` with 400 / 403 / 404 / 409.

## Try it

Start the server and open [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
to explore the API and send requests interactively. Create users first to get IDs
for trying the chat endpoints. The health check is at `/health`.

```bash
A=$(curl -s -XPOST localhost:3000/users -H 'content-type: application/json' -d '{"username":"alice"}' | jq -r .id)
B=$(curl -s -XPOST localhost:3000/users -H 'content-type: application/json' -d '{"username":"bob"}'   | jq -r .id)
C=$(curl -s -XPOST localhost:3000/chat/create -H 'content-type: application/json' -d "{\"userAId\":\"$A\",\"userBId\":\"$B\"}" | jq -r .chatId)
M=$(curl -s -XPOST localhost:3000/chat/$C/message/send -H 'content-type: application/json' -d "{\"senderId\":\"$A\",\"text\":\"hi bob\"}" | jq -r .id)
curl -s -XPOST localhost:3000/chat/$C/message/$M/read -H 'content-type: application/json' -d "{\"userId\":\"$B\"}"
curl -s -XPOST localhost:3000/chat/$C/lastseen -H 'content-type: application/json' -d "{\"userId\":\"$B\",\"messageId\":\"$M\"}"
curl -s "localhost:3000/chat/$C/messages?limit=50"
curl -s localhost:3000/user/$A/chats
```
