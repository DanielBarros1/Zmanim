# Zmanim — Product Spec

> Last updated: 2026-05-27
> Status: Draft — under review

---

## 1. Overview

Zmanim is a web-based scheduling tool for Ankori High School. Its primary purpose is to help the school admin construct a weekly schedule for the entire school — one week design that repeats across the academic year. The app replaces a manual Excel-based process.

The UI is in English. All user-generated content (teacher names, lesson names, room names, etc.) is in Hebrew and must render correctly in RTL.

---

## 2. Users & Milestones

### Milestone 1 — Admin (this spec)
The school admin and headmaster use the app to:
- Define the school's structure (grades, classes, teachers, rooms, subjects)
- Input lesson assignments (axioms)
- Construct the weekly schedule manually or automatically
- Validate against restrictions

### Milestone 2 — Teachers (future, not in scope)
Teachers access a read-only view of their own schedule.
> **Architecture note:** Data models and views should not assume teachers will never exist. Teacher-specific views built in Milestone 1 (for admin use) will likely become the foundation for Milestone 2.

---

## 3. School Structure

- **Grades:** 7–12 (6 grades)
- **Classes per grade:** 2 (e.g. 7A and 7B)
- **Total classes:** 12
- **School week:** Sunday–Thursday (5 days)
- **Lessons per day:** 4
- **Lesson duration:** 75 minutes
- **Recesses:** 3 per day (exact times configured by admin in the app)
- **Day start time:** Configured by admin in the app (all grades start at the same time)

---

## 4. Core Entities

### 4.1 Teacher
| Field | Notes |
|---|---|
| Name | Hebrew |
| Subjects they teach | References Subject entities |
| Restrictions | List of Restriction entities |

### 4.2 Subject
A subject category (e.g. "Math", "Art", "Theater", "History").
Subjects can be flagged as requiring a specialized room.

### 4.3 Room
| Field | Notes |
|---|---|
| Name | Hebrew |
| Capacity | Standard / Large (for shared lessons) |
| Specialized for | Optional — locks this room to a specific Subject when in use |

When a room is "specialized for" a subject (e.g. the Theater room), that subject *must* take place in that room. The room is available to other lessons when unused.

### 4.4 Class
A fixed group of students that stays together for most subjects (e.g. "9A", "9B").
Defined by grade + section.

### 4.5 Lesson (Axiom)
The core scheduling unit. Lesson assignments are decided by the admin and headmaster before scheduling begins and are treated as immutable inputs for Milestone 1.

Three lesson types exist:

**Regular Lesson**
One class, one teacher, one subject, N hours/week.
Example: *9A — History — Teacher Levi — 2hrs/week*

**Shared Lesson**
Two classes from the same grade attend together, same time, same room.
One teacher, one subject, N hours/week.
Example: *9A + 9B — Civics — Teacher Cohen — 1hr/week*

**Math Group Lesson**
Math is taught in cross-class level groups rather than by class. Students from both classes in a grade are re-sorted into 2 or 3 groups based on level (per the Israeli points system):
- **5-point group** — exists every year
- **4-point group** — exists every year
- **3-point group** — exists some years, not all

Each group has its own teacher and weekly hour count.
Example: *Grade 9 — Math (5-point) — Teacher Mizrahi — 5hrs/week*

> Math groups are grade-level entities, not class entities. They replace the per-class math lesson entirely for that grade.

### 4.6 Custom Block
A freeform schedule entry for electives, extracurriculars, or anything that doesn't fit the standard lesson model. Minimal scheduling logic — no conflict checking beyond room and teacher availability.
| Field | Notes |
|---|---|
| Label | Hebrew, free text |
| Assigned class(es) / grade(s) | Optional |
| Teacher | Optional |
| Room | Optional |
| Duration | In minutes |

---

## 5. Scheduling Workflow

The admin's core task is to place all lessons into time slots until the schedule is complete.

### 5.1 Lesson placement
- Lessons are placed into a **Day × Time Slot** grid
- Each placement is called a **Schedule Entry**
- A Schedule Entry = Lesson + Day + Slot

### 5.2 Manual scheduling
- Drag-and-drop interface
- Restriction violations are surfaced in real time as entries are placed or moved
- Violations are color-coded by restriction tier (see Section 6)
- Admin can override any non-"Non-negotiable" restriction with a confirmation

### 5.3 Auto-scheduler
The auto-scheduler attempts to fill the schedule (or remaining empty slots) automatically.

**Seed mode:** Admin can fix certain entries as immovable before running the auto-scheduler. Fixed entries act as hard anchors — the scheduler works around them.

**Scoring:** The auto-scheduler scores each candidate schedule using a penalty system:
- Every broken restriction contributes a penalty based on its tier
- Non-negotiable violations carry an exponentially higher penalty to strongly deter them
- The scheduler minimizes total penalty score

**Output:** The auto-scheduler always produces output — it never refuses to generate a schedule. If violations exist, they are clearly flagged with warnings and the penalty breakdown is shown. A "bad" schedule with visible warnings is more useful than no output.

---

## 6. Restriction System

Restrictions are constraints on how the schedule can be built. They are entered by the admin only.

### 6.1 Tiers
| Tier | Meaning |
|---|---|
| **Non-negotiable** | Must never be broken. Violations block placement entirely in manual mode. In auto-scheduler, treated with extreme penalty. |
| **Important** | Should not be broken. Violations are flagged prominently. Admin can override with confirmation. |
| **Preferred** | Better to respect, but breakable without special friction. Flagged as a warning. |
| **Flexible** | Nice to have. Noted in the schedule score but causes no UI friction. |

### 6.2 Restriction types (known at spec time)

**Teacher restrictions**
- Teacher unavailable on a specific day
- Teacher unavailable at a specific time slot
- Teacher can teach at most N days/week
- Teacher can teach at most N consecutive lessons without a break
- Teacher can't have too long a gap between lessons in the same day (window restriction)

**Class/grade restrictions**
- Grades 7–10 must not have windows (free periods mid-day) — **Non-negotiable**
- Grades 11–12 windows should be minimized — **Preferred**
- End-of-day gaps (student leaves early) are acceptable for all grades — not a restriction

**Room restrictions** (always Non-negotiable)
- Two lessons cannot share the same room at the same time
- A subject with a specialized room must be placed in that room

**Structural restrictions** (always Non-negotiable)
- A teacher cannot teach two lessons at the same time
- A class cannot have two lessons at the same time

> **Note:** The restriction system is expected to grow significantly. A deeper breakout session will happen during the Implementation Plan phase to enumerate all restriction types and their default tiers.

---

## 7. Views

### 7.1 Day Table (primary editing view)
- One table per school day (Sunday–Thursday)
- Columns: all 12 classes (7A, 7B, 8A, 8B … 12A, 12B) — horizontally scrollable
- Rows: time slots (lesson 1–4 + recesses)
- Each cell shows the lesson placed for that class at that time
- Color coding by subject or restriction status (TBD in design phase)

### 7.2 Teacher View
- Filtered to a single teacher
- Shows only that teacher's lessons across the full week
- Useful for admin review; forms the basis of Milestone 2 teacher access

### 7.3 Grade View
- Filtered to a single grade (both classes side by side)
- Shows the full week for that grade

### 7.4 Compact / Read View
- A condensed, color-coded view of the full schedule optimized for reading (not editing)
- Designed to be printable or shareable
- Replaces the current Excel-based output

---

## 8. Intake & Definitions Surface

Before scheduling can begin, the admin sets up:
- School day structure (start time, lesson duration, recess times)
- Teachers (name, subjects taught)
- Subjects (name, specialized room requirement)
- Rooms (name, capacity, specialization)
- Classes (auto-generated from grade + section config, or manually defined)
- Lesson assignments / axioms (Regular, Shared, Math Group)
- Restrictions (per teacher, per class, structural)

This surface is separate from the schedule editor and functions like a settings/configuration area.

---

## 9. Ideas for Future Milestones

These are deliberately out of scope for Milestone 1 but worth capturing so architecture decisions don't foreclose them.

- **Teacher login & personal schedule view** — teachers see their own week, receive notifications if the schedule changes
- **Maternity leave / substitution handling** — temporarily replace a teacher on a lesson without changing the axiom
- **Multi-week overrides** — handle school events, exam periods, or one-off week changes
- **Elective / specialty track scheduling** — fuller support for cross-grade elective blocks
- **Export** — PDF or Excel export of the finalized schedule
- **Schedule versioning** — save multiple draft schedules and compare them
- **Conflict resolution assistant** — when a hard conflict exists, suggest the minimum set of moves to resolve it
