import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

export function createDevelopmentLaunch(moduleUrl, environment) {
  const repositoryRoot = fileURLToPath(new URL("../../../", moduleUrl));
  return {
    serverRoot: fileURLToPath(new URL("../", moduleUrl)),
    environment: {
      ...environment,
      WEPOKER_ENV_FILE: resolve(repositoryRoot, environment.WEPOKER_ENV_FILE ?? ".env.docker.dev"),
    },
  };
}
