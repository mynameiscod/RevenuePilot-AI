// Only the API child is delayed. The real launcher and Vite remain unmodified,
// so an eager frontend reliably exposes a broken first browser request.
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/apps/api/src/index.ts"))
  await new Promise((resolve) => setTimeout(resolve, 2500));
