-- Unticketed admission is not inventory availability or a zero-price ticket.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'FREE';
