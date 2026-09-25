-- CreateEnum
CREATE TYPE "FundTxType" AS ENUM ('DEPOSIT', 'WITHDRAW', 'EXPENSE', 'TASK_REWARD', 'MILESTONE_BONUS', 'TASK_PENALTY');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED');

-- CreateEnum
CREATE TYPE "TaskScope" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "TaskFrequency" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🐷',
    "description" TEXT,
    "targetAmount" INTEGER,
    "dueDate" DATE,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundTransaction" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "type" "FundTxType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "userId" TEXT,
    "accountId" TEXT,
    "transactionId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "FundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "fundId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT NOT NULL DEFAULT '🎯',
    "targetAmount" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "deadline" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "achievedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT NOT NULL DEFAULT '✅',
    "scope" "TaskScope" NOT NULL DEFAULT 'PERSONAL',
    "assigneeId" TEXT,
    "frequency" "TaskFrequency" NOT NULL DEFAULT 'DAILY',
    "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "rewardAmount" INTEGER NOT NULL DEFAULT 0,
    "fundId" TEXT,
    "penaltyAmount" INTEGER NOT NULL DEFAULT 0,
    "penaltyText" TEXT,
    "penaltyStartDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "CheckInStatus" NOT NULL,
    "note" TEXT,
    "photoId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReward" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fundId" TEXT,
    "fundTransactionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPenalty" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "userId" TEXT,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT,
    "fundId" TEXT,
    "fundTransactionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,

    CONSTRAINT "TaskPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskMilestone" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "bonusAmount" INTEGER NOT NULL DEFAULT 0,
    "badgeEmoji" TEXT NOT NULL DEFAULT '🏅',
    "badgeName" TEXT NOT NULL,
    "rewardText" TEXT,

    CONSTRAINT "TaskMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskMilestoneClaim" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streakStartDate" DATE NOT NULL,
    "checkInId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskMilestoneClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fund_bookId_idx" ON "Fund"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "FundTransaction_transactionId_key" ON "FundTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "FundTransaction_fundId_deletedAt_idx" ON "FundTransaction"("fundId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundTransaction_bookId_clientRequestId_key" ON "FundTransaction"("bookId", "clientRequestId");

-- CreateIndex
CREATE INDEX "Goal_bookId_isActive_idx" ON "Goal"("bookId", "isActive");

-- CreateIndex
CREATE INDEX "Task_bookId_isActive_idx" ON "Task"("bookId", "isActive");

-- CreateIndex
CREATE INDEX "CheckIn_bookId_date_idx" ON "CheckIn"("bookId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_taskId_subjectKey_date_key" ON "CheckIn"("taskId", "subjectKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReward_sourceKey_key" ON "TaskReward"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReward_fundTransactionId_key" ON "TaskReward"("fundTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPenalty_fundTransactionId_key" ON "TaskPenalty"("fundTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPenalty_taskId_subjectKey_date_key" ON "TaskPenalty"("taskId", "subjectKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMilestone_taskId_days_key" ON "TaskMilestone"("taskId", "days");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMilestoneClaim_milestoneId_subjectKey_streakStartDate_key" ON "TaskMilestoneClaim"("milestoneId", "subjectKey", "streakStartDate");

-- CreateIndex
CREATE INDEX "UserAchievement_bookId_subjectKey_idx" ON "UserAchievement"("bookId", "subjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_sourceType_sourceId_key" ON "UserAchievement"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- AddForeignKey
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_fundTransactionId_fkey" FOREIGN KEY ("fundTransactionId") REFERENCES "FundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPenalty" ADD CONSTRAINT "TaskPenalty_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPenalty" ADD CONSTRAINT "TaskPenalty_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPenalty" ADD CONSTRAINT "TaskPenalty_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPenalty" ADD CONSTRAINT "TaskPenalty_fundTransactionId_fkey" FOREIGN KEY ("fundTransactionId") REFERENCES "FundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMilestone" ADD CONSTRAINT "TaskMilestone_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMilestoneClaim" ADD CONSTRAINT "TaskMilestoneClaim_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "TaskMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMilestoneClaim" ADD CONSTRAINT "TaskMilestoneClaim_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

