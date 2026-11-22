import { config } from "./config";
import { createApp } from "./app";
import { pool } from "./db/pool";

const server = createApp().listen(config.PORT, () => {
  console.log(`Chat backend listening on :${config.PORT}`);
});

function shutdown(): void {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
