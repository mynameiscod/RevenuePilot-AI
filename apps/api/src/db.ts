import mongoose from "mongoose";
import { allModels } from "./models.ts";
import { allJourneyModels } from "./journey/models.ts";
export async function connectDatabase(uri: string) {
  mongoose.set("strictQuery", "throw");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20,
  });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName)
    throw new Error(
      "MongoDB must run as a replica set; atomic writes cannot fall back to standalone mode.",
    );
  for (const model of [...allModels, ...allJourneyModels])
    await model.createIndexes();
}
export const transaction = <T>(
  work: (session: mongoose.ClientSession) => Promise<T>,
) => mongoose.connection.transaction(work);
