import express, { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors";
import swaggerUi from "swagger-ui-express";
import { apiSpec } from "./openapi";
import { chatRouter } from "./routes/chat";
import { userRouter } from "./routes/user";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(apiSpec));

  app.use(userRouter);
  app.use(chatRouter);

  const notFoundHandler: RequestHandler = (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
  };
  app.use(notFoundHandler);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "validation_error",
          message: "Invalid request",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: { code: "bad_json", message: "Malformed JSON body" } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
  };
  app.use(errorHandler);

  return app;
}
