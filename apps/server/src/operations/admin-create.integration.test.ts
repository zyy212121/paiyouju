import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearIntegrationDatabase,
  createIntegrationDatabase,
} from "../integration/database.js";
import { verifyPassword } from "../security/passwords.js";
import { createAdministrator } from "./admin-create.js";

const database = createIntegrationDatabase();
const input = {
  nickname: "首位管理员",
  password: "a-strong-admin-password",
  phoneNumber: "13900001234",
};

describe("administrator creation operation", () => {
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => {
    await clearIntegrationDatabase(database);
    await database.$disconnect();
  });

  it("creates an ADMIN with the formal Argon2id, Wallet and initial Ledger path", async () => {
    const result = await createAdministrator(database, input, 10_000, {
      username: () => "u_adminfixture000000000001",
    });
    expect(result).toMatchObject({ alreadyExists: false, phoneMasked: "139****1234" });
    const user = await database.user.findUniqueOrThrow({
      include: { sessions: true, wallet: { include: { entries: true } } },
      where: { phoneNumber: input.phoneNumber },
    });
    expect(user.role).toBe("ADMIN");
    await expect(verifyPassword(user.passwordHash, input.password)).resolves.toBe(true);
    expect(user.sessions).toHaveLength(0);
    expect(user.wallet).toMatchObject({ balance: 10_000, version: 1 });
    expect(user.wallet?.entries).toHaveLength(1);
    expect(user.wallet?.entries[0]).toMatchObject({ signedAmount: 10_000, type: "INITIAL_GRANT" });
  });

  it("is safely idempotent only for identical existing administrator information", async () => {
    await createAdministrator(database, input, 10_000);
    await expect(createAdministrator(database, input, 10_000)).resolves.toMatchObject({ alreadyExists: true });
    await expect(createAdministrator(database, { ...input, nickname: "不匹配" }, 10_000)).rejects.toThrow(/信息不匹配/u);
    await expect(createAdministrator(database, { ...input, password: "another-strong-password" }, 10_000)).rejects.toThrow(/信息不匹配/u);
    expect(await database.user.count()).toBe(1);
    expect((await database.user.findUniqueOrThrow({ where: { phoneNumber: input.phoneNumber } })).nickname).toBe(input.nickname);
  });
});
