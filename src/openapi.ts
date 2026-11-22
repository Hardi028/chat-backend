const uuid = { type: "string", format: "uuid" };
const jsonBody = (schema: object) => ({
  required: true,
  content: { "application/json": { schema } },
});
const responses = {
  "200": { description: "Success" },
  "400": { description: "Invalid request" },
  "404": { description: "Resource not found" },
};

export const apiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Chat Backend API",
    version: "1.0.0",
    description: "Create users and test chat and messaging operations.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/health": {
      get: {
        summary: "Check API health",
        responses: { "200": { description: "API is running" } },
      },
    },
    "/users": {
      post: {
        summary: "Create a user",
        requestBody: jsonBody({ $ref: "#/components/schemas/CreateUser" }),
        responses: { ...responses, "201": { description: "User created" } },
      },
    },
    "/user/{userId}/chats": {
      get: {
        summary: "List a user's chats",
        parameters: [{ name: "userId", in: "path", required: true, schema: uuid }],
        responses,
      },
    },
    "/chat/create": {
      post: {
        summary: "Create or get a direct chat",
        requestBody: jsonBody({ $ref: "#/components/schemas/CreateChat" }),
        responses: { ...responses, "201": { description: "Chat created" } },
      },
    },
    "/chat/group": {
      post: {
        summary: "Create a group chat",
        requestBody: jsonBody({ $ref: "#/components/schemas/CreateGroup" }),
        responses: { ...responses, "201": { description: "Group chat created" } },
      },
    },
    "/chat/{chatId}": {
      get: {
        summary: "Get a chat",
        parameters: [{ name: "chatId", in: "path", required: true, schema: uuid }],
        responses,
      },
    },
    "/chat/{chatId}/message/send": {
      post: {
        summary: "Send a message",
        parameters: [{ name: "chatId", in: "path", required: true, schema: uuid }],
        requestBody: jsonBody({ $ref: "#/components/schemas/SendMessage" }),
        responses: { ...responses, "201": { description: "Message sent" } },
      },
    },
    "/chat/{chatId}/messages": {
      get: {
        summary: "List messages",
        parameters: [
          { name: "chatId", in: "path", required: true, schema: uuid },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "before", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "userId", in: "query", schema: uuid },
        ],
        responses,
      },
    },
    "/chat/{chatId}/message/{messageId}/read": {
      post: {
        summary: "Mark a message as read",
        parameters: [
          { name: "chatId", in: "path", required: true, schema: uuid },
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: jsonBody({ $ref: "#/components/schemas/UserId" }),
        responses,
      },
    },
    "/chat/{chatId}/lastseen": {
      get: {
        summary: "Get last-seen markers",
        parameters: [
          { name: "chatId", in: "path", required: true, schema: uuid },
          { name: "userId", in: "query", required: true, schema: uuid },
        ],
        responses,
      },
      post: {
        summary: "Update a last-seen marker",
        parameters: [{ name: "chatId", in: "path", required: true, schema: uuid }],
        requestBody: jsonBody({ $ref: "#/components/schemas/LastSeen" }),
        responses,
      },
    },
    "/chat/{chatId}/message/{messageId}": {
      patch: {
        summary: "Edit a message",
        parameters: [
          { name: "chatId", in: "path", required: true, schema: uuid },
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: jsonBody({ $ref: "#/components/schemas/EditMessage" }),
        responses,
      },
      delete: {
        summary: "Delete a message",
        parameters: [
          { name: "chatId", in: "path", required: true, schema: uuid },
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: jsonBody({ $ref: "#/components/schemas/UserId" }),
        responses,
      },
    },
    "/chat/{chatId}/members": {
      post: {
        summary: "Add members to a group chat",
        parameters: [{ name: "chatId", in: "path", required: true, schema: uuid }],
        requestBody: jsonBody({ $ref: "#/components/schemas/AddMembers" }),
        responses,
      },
    },
    "/chat/{chatId}/members/{userId}": {
      delete: {
        summary: "Remove a member from a group chat",
        parameters: [
          { name: "chatId", in: "path", required: true, schema: uuid },
          { name: "userId", in: "path", required: true, schema: uuid },
        ],
        requestBody: jsonBody({ $ref: "#/components/schemas/RequesterId" }),
        responses,
      },
    },
  },
  components: {
    schemas: {
      CreateUser: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", minLength: 2, maxLength: 40, example: "alice" },
          displayName: { type: "string", maxLength: 80, example: "Alice" },
        },
      },
      CreateChat: {
        type: "object",
        required: ["userAId", "userBId"],
        properties: { userAId: uuid, userBId: uuid },
      },
      CreateGroup: {
        type: "object",
        required: ["creatorId", "name", "memberIds"],
        properties: {
          creatorId: uuid,
          name: { type: "string", minLength: 1, maxLength: 100 },
          memberIds: { type: "array", minItems: 1, maxItems: 255, items: uuid },
        },
      },
      SendMessage: {
        type: "object",
        required: ["senderId", "text"],
        properties: {
          senderId: uuid,
          text: { type: "string", minLength: 1, maxLength: 4000 },
        },
      },
      UserId: {
        type: "object",
        required: ["userId"],
        properties: { userId: uuid },
      },
      LastSeen: {
        type: "object",
        required: ["userId", "messageId"],
        properties: { userId: uuid, messageId: { type: "string", minLength: 1 } },
      },
      EditMessage: {
        type: "object",
        required: ["userId", "text"],
        properties: {
          userId: uuid,
          text: { type: "string", minLength: 1, maxLength: 4000 },
        },
      },
      AddMembers: {
        type: "object",
        required: ["requesterId", "userIds"],
        properties: {
          requesterId: uuid,
          userIds: { type: "array", minItems: 1, items: uuid },
        },
      },
      RequesterId: {
        type: "object",
        required: ["requesterId"],
        properties: { requesterId: uuid },
      },
    },
  },
} as const;
