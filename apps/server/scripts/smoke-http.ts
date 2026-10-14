import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3103";
const origin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const suffix = randomUUID().replaceAll("-", "").slice(0, 8);

interface Session {
  cookie: string;
  username: string;
}

async function request(
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    session?: Session;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.method && options.method !== "GET" ? { origin } : {}),
      ...(options.session ? { cookie: options.session.cookie } : {}),
      ...options.headers,
    },
    method: options.method ?? "GET",
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return { payload, response };
}

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert(value, "expected Set-Cookie");
  return value.split(";", 1)[0] ?? "";
}

async function register(label: string): Promise<Session> {
  const username = `${label}_${suffix}`;
  const result = await request("/api/auth/register", {
    body: { nickname: label, password: "smoke-test-password", username },
    method: "POST",
  });
  assert.equal(result.response.status, 201);
  return { cookie: cookieFrom(result.response), username };
}

const health = await request("/health");
assert.equal(health.response.status, 200);

const owner = await register("owner");
const member = await register("member");
const outsider = await register("outsider");

const login = await request("/api/auth/login", {
  body: { password: "smoke-test-password", username: owner.username },
  method: "POST",
});
assert.equal(login.response.status, 200);
owner.cookie = cookieFrom(login.response);

assert.equal((await request("/api/me", { session: owner })).response.status, 200);
assert.equal((await request("/api/wallet", { session: owner })).response.status, 200);

const created = await request("/api/rooms", {
  body: {
    actionTimeSeconds: 30,
    bigBlind: 20,
    maximumBuyIn: 2_000,
    maxSeats: 9,
    minimumBuyIn: 400,
    name: "冒烟房间",
    paidCardRevealCost: 0,
    paidCardRevealEnabled: false,
    password: "room-password",
  },
  headers: { "idempotency-key": `smoke-create:${suffix}` },
  method: "POST",
  session: owner,
});
assert.equal(created.response.status, 201);
const room = (created.payload.data ?? {}) as { id?: string; roomCode?: string };
assert(room.id && room.roomCode);

const joined = await request("/api/rooms/join", {
  body: { password: "room-password", roomCode: room.roomCode },
  method: "POST",
  session: member,
});
assert.equal(joined.response.status, 200);
for (const action of ["pause", "resume", "close"]) {
  const result = await request(`/api/rooms/${room.id}/${action}`, {
    method: "POST",
    session: owner,
  });
  assert.equal(result.response.status, 200);
}
const denied = await request("/api/rooms/join", {
  body: { password: "room-password", roomCode: room.roomCode },
  method: "POST",
  session: outsider,
});
assert.equal(denied.response.status, 403);
assert.equal((denied.payload.error as { code?: string }).code, "ROOM_JOIN_DENIED");

process.stdout.write("Built HTTP smoke flow PASS\n");
