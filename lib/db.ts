import { createPrismaClient } from './prisma-client.mjs';
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
