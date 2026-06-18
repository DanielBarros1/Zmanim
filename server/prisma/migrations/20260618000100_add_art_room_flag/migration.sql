-- Add isArtRoom flag to Room table (for art rooms reserved for art lessons only)
ALTER TABLE "Room" ADD COLUMN "isArtRoom" BOOLEAN NOT NULL DEFAULT false;
