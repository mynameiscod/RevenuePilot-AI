// MongoDB's Unix socket flag is not recognized by mongod.exe on Windows.
// Share these options between the demo and tests so both boot the same database.
export function memoryMongoOptions(
  platform: NodeJS.Platform = process.platform,
) {
  return {
    replSet: {
      count: 1,
      args: platform === "win32" ? [] : ["--nounixsocket"],
    },
    binary: { version: "7.0.48" },
  };
}
