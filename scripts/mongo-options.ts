// MongoDB's Unix socket flag is not recognized by mongod.exe on Windows.
// Share these options between the demo and tests so both boot the same database.
export function memoryMongoOptions(
  platform: NodeJS.Platform = process.platform,
) {
  return {
    // A freshly extracted mongod.exe can exceed the library's 10-second
    // default on Windows. Keep startup bounded without retrying failed boots.
    instanceOpts: [{ launchTimeout: platform === "win32" ? 60000 : 30000 }],
    replSet: {
      count: 1,
      args: platform === "win32" ? [] : ["--nounixsocket"],
      // Terminal Ctrl+C must reach the owner, not mongod concurrently with
      // replica-set shutdown. The library still owns and reaps this child
      // (including its parent-death watchdog); no persistent service is started.
      spawn: { detached: true, windowsHide: true },
    },
    binary: { version: "7.0.48" },
  };
}
