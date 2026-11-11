import "dotenv/config";
import { defineConfig } from "prisma/config";

// Generation/builds need no database; migration commands require DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
