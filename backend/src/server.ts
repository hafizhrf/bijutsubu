import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectControlPlane } from "./db/controlPlaneConnection.js";

async function main() {
  await connectControlPlane();
  app.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
