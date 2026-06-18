-- Add isSmall flag to Room table (for small room capacity tiers)
ALTER TABLE "Room" ADD COLUMN "isSmall" BOOLEAN NOT NULL DEFAULT false;

-- Add allowSmallRoom flag to Lesson table (allows lesson to be placed in small rooms)
ALTER TABLE "Lesson" ADD COLUMN "allowSmallRoom" BOOLEAN NOT NULL DEFAULT false;
