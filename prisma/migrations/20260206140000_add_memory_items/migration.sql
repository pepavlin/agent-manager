-- CreateEnum
CREATE TYPE "MemoryItemType" AS ENUM ('fact', 'rule', 'event', 'decision', 'open_loop', 'idea', 'metric', 'preference', 'lesson');

-- CreateEnum
CREATE TYPE "MemoryItemSource" AS ENUM ('user_chat', 'doc_upload', 'tool_result', 'cron', 'system');

-- CreateEnum
CREATE TYPE "MemoryItemStatus" AS ENUM ('proposed', 'accepted', 'rejected', 'done', 'blocked', 'active');

-- CreateTable
CREATE TABLE "memory_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "MemoryItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "MemoryItemStatus" DEFAULT 'proposed',
    "source" "MemoryItemSource" NOT NULL DEFAULT 'user_chat',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "supersedes_id" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qdrant_point_id" TEXT,

    CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_items_project_id_type_idx" ON "memory_items"("project_id", "type");

-- CreateIndex
CREATE INDEX "memory_items_project_id_user_id_type_idx" ON "memory_items"("project_id", "user_id", "type");

-- CreateIndex
CREATE INDEX "memory_items_project_id_expires_at_idx" ON "memory_items"("project_id", "expires_at");

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "memory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
