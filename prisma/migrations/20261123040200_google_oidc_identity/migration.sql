-- CreateTable
CREATE TABLE "GoogleOAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "encryptedVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,

    CONSTRAINT "GoogleOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "GoogleIdentity" (
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleIdentity_pkey" PRIMARY KEY ("subject")
);

-- CreateIndex
CREATE INDEX "GoogleOAuthAttempt_expiresAt_idx" ON "GoogleOAuthAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "GoogleOAuthAttempt_sessionId_idx" ON "GoogleOAuthAttempt"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleIdentity_userId_key" ON "GoogleIdentity"("userId");

-- AddForeignKey
ALTER TABLE "GoogleOAuthAttempt" ADD CONSTRAINT "GoogleOAuthAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleIdentity" ADD CONSTRAINT "GoogleIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
