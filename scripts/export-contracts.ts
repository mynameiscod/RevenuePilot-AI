import { writeFileSync } from "node:fs";
import { z } from "zod";
import * as core from "../packages/core/src/contracts.ts";
import * as journey from "../packages/core/src/journey.ts";
import { connectionSettings } from "../packages/connectors/src/settings.ts";
const schemas: Record<string, unknown> = {};
for (const [name, value] of Object.entries({ ...core, ...journey }))
  if (value instanceof z.ZodType)
    schemas[name] = z.toJSONSchema(value, {
      io: "input",
      unrepresentable: "any",
    });
for (const [name, value] of Object.entries(connectionSettings))
  schemas[`provider_${name}`] = z.toJSONSchema(value, {
    io: "input",
    unrepresentable: "any",
  });
writeFileSync(
  "docs/REQUEST_SCHEMAS.json",
  `${JSON.stringify({ description: "Generated from executable Zod request schemas. Custom cross-field/BigInt/origin refinements remain authoritative in TypeScript and API.md.", schemas }, null, 2)}\n`,
);
console.log(`Exported ${Object.keys(schemas).length} request schemas.`);
