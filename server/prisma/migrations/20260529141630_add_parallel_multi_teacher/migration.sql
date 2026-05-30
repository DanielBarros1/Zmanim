-- AlterEnum: add PARALLEL and MULTI_TEACHER to LessonType
-- PostgreSQL 12+ supports adding multiple values in one transaction.
ALTER TYPE "LessonType" ADD VALUE IF NOT EXISTS 'PARALLEL';
ALTER TYPE "LessonType" ADD VALUE IF NOT EXISTS 'MULTI_TEACHER';

-- AlterTable: make teacherId nullable on Lesson
-- (PARALLEL and MULTI_TEACHER use LessonTeacher instead)
ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_teacherId_fkey";
ALTER TABLE "Lesson" ALTER COLUMN "teacherId" DROP NOT NULL;

-- CreateTable: LessonTeacher join table
CREATE TABLE "LessonTeacher" (
    "lessonId"  TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classId"   TEXT,

    CONSTRAINT "LessonTeacher_pkey" PRIMARY KEY ("lessonId","teacherId")
);

-- AddForeignKey: restore Lesson.teacherId FK (now nullable, SET NULL on delete)
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: LessonTeacher → Lesson
ALTER TABLE "LessonTeacher" ADD CONSTRAINT "LessonTeacher_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: LessonTeacher → Teacher
ALTER TABLE "LessonTeacher" ADD CONSTRAINT "LessonTeacher_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: LessonTeacher → Class (nullable)
ALTER TABLE "LessonTeacher" ADD CONSTRAINT "LessonTeacher_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
