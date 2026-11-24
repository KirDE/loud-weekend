CREATE TABLE "CalendarSubscription" (
    "userId" TEXT NOT NULL,
    "keyDigest" TEXT NOT NULL,
    "seasons" INTEGER[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarSubscription_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "CalendarSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CalendarSubscription_keyDigest_key" ON "CalendarSubscription"("keyDigest");
