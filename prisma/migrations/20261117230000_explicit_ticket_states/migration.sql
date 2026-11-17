-- Additive only: legacy UNAVAILABLE remains ambiguous, never silently SOLD_OUT.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'NOT_ON_SALE';
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'SOLD_OUT';
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'SALES_ENDED';
