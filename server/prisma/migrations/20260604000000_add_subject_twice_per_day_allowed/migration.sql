-- Add subjectTwicePerDayAllowed to SchoolConfig
-- Subject IDs in this array are exempt from the D7 hard invariant
-- (no same subject at two different slots on the same day for a class).

ALTER TABLE "SchoolConfig" ADD COLUMN "subjectTwicePerDayAllowed" TEXT[] NOT NULL DEFAULT '{}';
