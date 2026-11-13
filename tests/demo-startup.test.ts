import { expect, it } from "vitest";
import { fork } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
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

it("waits for a slow API before serving Vite and signs in with either local hostname", async () => {
  const [apiPort, webPort] = await freePorts();
  const origin = `http://127.0.0.1:${webPort}`;
  const configuredOrigin = `http://localhost:${webPort}`;
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
        WEB_ORIGIN: `${configuredOrigin}/`,
        VITE_DEV_HOST: "127.0.0.1",
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${new URL("./fixtures/slow-api-start.mjs", import.meta.url).href}`,
        ]
          .filter(Boolean)
          .join(" "),
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
        const web = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        if (web.ok) {
          ready = true;
          break;
        }
      } catch {
        /* The database and child servers are still starting. */
      }
      await delay(50);
    }
    expect(ready, `Demo did not become ready:\n${output}`).toBe(true);
    // Mirror the login page's first requests as soon as Vite accepts traffic,
    // without masking startup races by first waiting for the API in this test.
    const [publicConfig, initialSession, health] = await Promise.all([
      fetch(`${origin}/api/v1/public/config`),
      fetch(`${origin}/api/v1/auth/session`),
      fetch(`${api}/health/ready`).catch(() => null),
    ]);
    expect(publicConfig.status, output).toBe(200);
    expect(await publicConfig.json()).toMatchObject({ demo: true });
    expect(initialSession.status, output).toBe(401);
    expect(health?.status, output).toBe(200);
    const sdk = await fetch(`${origin}/revenuepilot-sdk.js`, {
      headers: { Origin: "https://landing.example.test" },
    });
    expect(sdk.status, output).toBe(200);
    expect(sdk.headers.get("content-type")).toContain("javascript");
    expect(sdk.headers.get("access-control-allow-origin")).toBe("*");
    expect(await sdk.text()).toContain("createIntake");
    for (const browserOrigin of [origin, configuredOrigin]) {
      // Use the same frontend proxy as the browser, not the API port directly.
      const login = await fetch(`${browserOrigin}/api/v1/auth/demo`, {
        method: "POST",
        headers: { Origin: browserOrigin },
      });
      expect(login.status).toBe(200);
      expect(login.headers.get("access-control-allow-origin")).toBe(
        browserOrigin,
      );
      const session = await login.json();
      expect(
        session.tenants.map((tenant: { name: string }) => tenant.name),
      ).toEqual(["CodeBegun", "Northstar Studio"]);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const overview = await fetch(
        `${browserOrigin}/api/v1/tenants/${session.tenants[0].id}/overview`,
        { headers: { Cookie: cookie } },
      );
      expect(overview.status).toBe(200);
      expect((await overview.json()).leadCount).toBe(48);
    }
    expect(output).not.toContain("ECONNREFUSED");
  } finally {
    if (!exited && child.connected) child.send({ type: "shutdown" });
    await Promise.race([completion, delay(10000)]);
    if (!exited) child.kill();
  }
}, 120000);

it("does not start Vite when a different process already owns the API port", async () => {
  // Even a healthy-looking listener must not stand in for this launcher's API.
  const occupied = createHttpServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end('{"status":"ready"}');
  });
  await new Promise<void>((resolve) => occupied.listen(0, "0.0.0.0", resolve));
  const apiPort = (occupied.address() as AddressInfo).port;
  const [webPort] = await freePorts();
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
        WEB_ORIGIN: `http://localhost:${webPort}`,
        VITE_DEV_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  const capture = (chunk: Buffer) => {
    output = (output + chunk).slice(-16000);
  };
  child.stdout!.on("data", capture);
  child.stderr!.on("data", capture);
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  try {
    const result = await Promise.race([
      completion.then((code) => ({ exited: true, code })),
      delay(40000, undefined, { ref: false }).then(() => ({
        exited: false,
        code: null,
      })),
    ]);
    expect(result.exited, output).toBe(true);
    expect(result.code, output).toBe(1);
    expect(output).toContain("EADDRINUSE");
    expect(output).not.toContain("RevenuePilot API ready");
    expect(output).not.toMatch(/VITE v/);
    await expect(
      fetch(`http://127.0.0.1:${webPort}`, {
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
  } finally {
    if (child.exitCode === null && child.connected)
      child.send({ type: "shutdown" });
    await Promise.race([completion, delay(10000)]);
    if (child.exitCode === null) child.kill();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
}, 60000);
