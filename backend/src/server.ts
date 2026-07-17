import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectControlPlane } from "./db/controlPlaneConnection.js";
import { startSourceScheduler } from "./services/sourceScheduler.service.js";

async function main() {
  await connectControlPlane();
  startSourceScheduler();
  app.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
