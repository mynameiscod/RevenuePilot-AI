import { expect, it } from "vitest";
import { fork } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function freePorts() {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          }),
      ),
    );
    return servers.map((server) => (server.address() as AddressInfo).port);
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }
}

it("boots the real demo, seeds CodeBegun and serves the API and frontend", async () => {
  const [apiPort, webPort] = await freePorts();
  const origin = `http://127.0.0.1:${webPort}`;
  const api = `http://127.0.0.1:${apiPort}`;
  const child = fork(
    fileURLToPath(new URL("../scripts/dev.mjs", import.meta.url)),
    ["--demo", "--port", String(webPort)],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      execArgv: [],
      env: {
        ...process.env,
        NODE_ENV: "test",
        API_PORT: String(apiPort),
        WEB_ORIGIN: origin,
        VITE_DEV_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "",
    exited = false;
  child.stdout!.on("data", (chunk) => {
    output = (output + chunk).slice(-16000);
  });
  child.stderr!.on("data", (chunk) => {
    output = (output + chunk).slice(-16000);
  });
  const completion = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
    child.once("error", (error) => {
      output += error.message;
      exited = true;
      resolve();
    });
  });
  try {
    const deadline = Date.now() + 100000;
    let ready = false;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Demo exited before startup:\n${output}`);
      try {
        const response = await fetch(`${api}/health/ready`, {
          signal: AbortSignal.timeout(1000),
        });
        const web = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        if (response.ok && web.ok) {
          ready = true;
          break;
        }
      } catch {
        /* The database and child servers are still starting. */
      }
      await delay(250);
    }
    expect(ready, `Demo did not become ready:\n${output}`).toBe(true);
    const login = await fetch(`${api}/api/v1/auth/demo`, {
      method: "POST",
      headers: { Origin: origin },
    });
    expect(login.status).toBe(200);
    const session = await login.json();
    expect(
      session.tenants.map((tenant: { name: string }) => tenant.name),
    ).toEqual(["CodeBegun", "Northstar Studio"]);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const overview = await fetch(
      `${api}/api/v1/tenants/${session.tenants[0].id}/overview`,
      { headers: { Cookie: cookie } },
    );
    expect(overview.status).toBe(200);
    expect((await overview.json()).leadCount).toBe(48);
  } finally {
    if (!exited && child.connected) child.send({ type: "shutdown" });
    await Promise.race([completion, delay(10000)]);
    if (!exited) child.kill();
  }
}, 120000);
