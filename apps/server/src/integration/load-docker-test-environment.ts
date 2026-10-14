import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({
  override: true,
  path: process.env.WEPOKER_ENV_FILE
    ?? fileURLToPath(new URL("../../../../.env.docker.test", import.meta.url)),
  quiet: true,
});
