-- CreateTable: AllowedEmail
-- Stores emails permitted to log in (invited by root users).
-- Root users are defined in the ALLOWED_EMAILS env var and are NOT stored here.

CREATE TABLE "AllowedEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllowedEmail_email_key" ON "AllowedEmail"("email");
