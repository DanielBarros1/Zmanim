-- Add noRoomRequired flag to Subject.
-- When true, the auto-scheduler will not assign a room to lessons of this subject
-- and no "room not assigned" violation is raised.

ALTER TABLE "Subject" ADD COLUMN "noRoomRequired" BOOLEAN NOT NULL DEFAULT false;
