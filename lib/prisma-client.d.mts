import { PrismaClient, Prisma } from '@prisma/client';
export function createPrismaClient(options?: {url?: string; log?: Prisma.PrismaClientOptions['log']}): PrismaClient;
