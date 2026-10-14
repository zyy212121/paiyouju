import dotenv from "dotenv";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { loadEnvironment, resolveRootEnvironmentPath } from "../src/config/environment.js";
import { createDatabaseClient } from "../src/db/client.js";
import { createAdministrator } from "../src/operations/admin-create.js";

dotenv.config({
  path: process.env.WEPOKER_ENV_FILE ?? resolveRootEnvironmentPath(import.meta.url),
  quiet: true,
});

async function hiddenPrompt(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("admin:create 必须在交互式终端运行，以确保密码不会回显");
  }
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise<string>((resolvePromise, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolvePromise(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("管理员创建已取消"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = value.slice(0, -1);
        } else if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

let database: ReturnType<typeof createDatabaseClient> | undefined;
try {
  if (process.argv.length > 2) {
    throw new Error("admin:create 不接受命令行参数；密码不得进入 Shell History");
  }
  const environment = loadEnvironment();
  const terminal = createInterface({ input: stdin, output: stdout });
  const phoneNumber = (await terminal.question("管理员手机号：")).trim();
  const nickname = (await terminal.question("管理员昵称：")).trim();
  terminal.close();
  const password = await hiddenPrompt("管理员密码（隐藏输入）：");
  const confirmation = await hiddenPrompt("再次输入密码（隐藏输入）：");
  if (password !== confirmation) throw new Error("两次密码输入不一致");

  database = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
  const result = await createAdministrator(database, { nickname, password, phoneNumber }, environment.INITIAL_USER_POINTS);
  stdout.write(`${JSON.stringify({ event: "admin.created", ...result })}\n`);
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : "管理员创建失败"}\n`);
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
