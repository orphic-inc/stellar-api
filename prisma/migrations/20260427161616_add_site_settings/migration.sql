-- CreateTable
CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL,
    "approvedDomains" TEXT[],
    "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'open',
    "maxUsers" INTEGER NOT NULL DEFAULT 7000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);
