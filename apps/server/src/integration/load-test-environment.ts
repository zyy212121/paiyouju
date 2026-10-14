import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({
  override: true,
  path: fileURLToPath(new URL("../../../../.env.test", import.meta.url)),
  quiet: true,
});
