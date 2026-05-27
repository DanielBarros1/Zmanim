# Zmanim — Implementation Plan

> Last updated: 2026-05-27
> Status: Approved
> Prerequisite reading: product-spec.md, design-spec.md

---

## 0. Stack Summary

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Auth | Google OAuth 2.0 (Passport.js) + express-session |
| Client state | Zustand |
| Server state | TanStack Query (React Query) |
| Drag & drop | @dnd-kit/core |
| Styling | Tailwind CSS |
| Monorepo | npm workspaces |

---

## 1. Project Structure

```
zmanim/
├── package.json               # root — npm workspaces
├── client/                    # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── schedule/      # Grid, LessonCard, EmptyCell, DayTabs, ViolationsBanner
│   │   │   ├── definitions/   # Forms for teachers, rooms, subjects, lessons, restrictions
│   │   │   ├── views/         # TeacherView, GradeView, CompactView
│   │   │   └── ui/            # Generic: Button, Badge, Modal, Sidebar, Topbar
│   │   ├── pages/
│   │   │   ├── Home.tsx               # Schedule list
│   │   │   ├── ScheduleEditor.tsx     # Main editor
│   │   │   ├── ReviewMode.tsx         # Post-AS review
│   │   │   ├── definitions/           # All intake pages
│   │   │   └── views/                 # Teacher/grade/compact view pages
│   │   ├── store/
│   │   │   ├── scheduleStore.ts       # Active schedule, drag state, selected entry
│   │   │   └── uiStore.ts             # Dark mode, active day, review mode flag
│   │   ├── hooks/                     # Custom hooks wrapping TanStack Query
│   │   ├── lib/
│   │   │   └── evaluator.ts           # Client-side constraint evaluator (shared logic)
│   │   └── api/                       # API call functions
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── schedules.ts
│   │   │   ├── entries.ts
│   │   │   ├── teachers.ts
│   │   │   ├── rooms.ts
│   │   │   ├── subjects.ts
│   │   │   ├── lessons.ts
│   │   │   ├── restrictions.ts
│   │   │   ├── config.ts
│   │   │   └── autoscheduler.ts
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts
│   │   │   └── requireRole.ts
│   │   ├── services/
│   │   │   ├── evaluator.ts           # Authoritative constraint evaluator
│   │   │   └── autoscheduler.ts       # AS algorithm + worker thread
│   │   └── app.ts
│   └── prisma/
│       └── schema.prisma
└── shared/
    └── types/
        ├── entities.ts                # All shared entity types
        ├── restrictions.ts            # RestrictionType, tier enums, params shapes
        └── evaluator.ts               # Violation, EvaluationResult types
```

---

## 2. Database Schema

Full Prisma schema. Implement this before any feature work begins.

```prisma
// schema.prisma

enum Role {
  ADMIN
  TEACHER
}

enum Day {
  SUNDAY
  MONDAY
  TUESDAY
  WEDNESDAY
  THURSDAY
}

enum RoomCapacity {
  STANDARD
  LARGE
}

enum LessonType {
  REGULAR     // one class, one teacher
  SHARED      // two classes, same room, same time
  MATH_GROUP  // cross-class level group
}

enum MathLevel {
  THREE_POINT
  FOUR_POINT
  FIVE_POINT
}

enum ScheduleState {
  DRAFT
  PUBLISHED
}

enum RestrictionTier {
  NON_NEGOTIABLE
  IMPORTANT
  PREFERRED
  FLEXIBLE
}

enum RestrictionType {
  // Category A — Teacher
  TEACHER_UNAVAILABLE_DAY           // params: { day: Day }
  TEACHER_UNAVAILABLE_SLOT          // params: { slot: number }
  TEACHER_UNAVAILABLE_DAY_SLOT      // params: { day: Day, slot: number }
  TEACHER_MAX_DAYS_PER_WEEK         // params: { max: number }
  TEACHER_MIN_DAYS_PER_WEEK         // params: { min: number }
  TEACHER_MAX_LESSONS_PER_DAY       // params: { max: number }
  TEACHER_MAX_CONSECUTIVE           // params: { max: number }
  TEACHER_MAX_WINDOW                // params: { maxSlots: number }
  TEACHER_NO_SINGLE_LESSON_DAY      // params: {}

  // Category B — Class/grade quality
  CLASS_NO_WINDOW                   // params: {} — applied to grades 7-10 by default
  CLASS_MINIMIZE_WINDOWS            // params: {} — applied to grades 11-12 by default
  CLASS_NO_SUBJECT_TWICE_PER_DAY    // params: {}
  CLASS_ARTS_BALANCE                // params: {}
  CLASS_NO_SUBJECT_EDGE_MULTIPLE_DAYS // params: { maxDays: number }

  // Category C — Room
  ROOM_LARGE_FOR_SHARED             // params: {} — auto-applied to SHARED lessons

  // Category E — Lesson preferences
  LESSON_AVOID_DAY                  // params: { day: Day }
  LESSON_AVOID_SLOT                 // params: { slot: number }
  LESSON_PREFER_MORNING             // params: {}
  LESSON_PREFER_AFTERNOON           // params: {}
  LESSON_GRADE_SYNC                 // params: {} — both classes in grade share the slot
}

// Category D restrictions (D1–D6) are hard-coded invariants in the evaluator.
// They have no DB records — they are always evaluated.

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  googleId  String   @unique
  role      Role     @default(ADMIN)
  teacherId String?  // links to Teacher for TEACHER role users
  teacher   Teacher? @relation(fields: [teacherId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model SchoolConfig {
  id             String  @id @default(uuid())
  dayStartTime   String  // "08:00"
  lessonDuration Int     // minutes — 75
  slotsPerDay    Int     // 4
  recesses       Json    // [{ afterSlot: 1, durationMinutes: 15 }, ...]
  workDays       Day[]   // [SUNDAY, MONDAY, ...]
}

model Subject {
  id               String   @id @default(uuid())
  name             String   // Hebrew
  isArts           Boolean  @default(false)
  color            String   // hex — from design system palette
  specializedRoom  Room?    @relation(fields: [specializedRoomId], references: [id])
  specializedRoomId String?
  lessons          Lesson[]
  restrictions     Restriction[]
  createdAt        DateTime @default(now())
}

model Room {
  id               String       @id @default(uuid())
  name             String       // Hebrew
  capacity         RoomCapacity @default(STANDARD)
  specializedFor   Subject[]    // subjects that must use this room
  entries          ScheduleEntry[]
  createdAt        DateTime     @default(now())
}

model Teacher {
  id           String        @id @default(uuid())
  name         String        // Hebrew
  subjects     Subject[]     @relation("TeacherSubjects")
  lessons      Lesson[]
  restrictions Restriction[]
  user         User[]        // linked login account(s)
  createdAt    DateTime      @default(now())
}

model Grade {
  id       String  @id @default(uuid())
  number   Int     // 7–12
  classes  Class[]
  lessons  Lesson[]
}

model Class {
  id       String  @id @default(uuid())
  gradeId  String
  grade    Grade   @relation(fields: [gradeId], references: [id])
  section  String  // "A" | "B"
  lessons  Lesson[] @relation("ClassLessons")
  restrictions Restriction[]
}

model Lesson {
  id           String      @id @default(uuid())
  type         LessonType
  subject      Subject     @relation(fields: [subjectId], references: [id])
  subjectId    String
  teacher      Teacher     @relation(fields: [teacherId], references: [id])
  teacherId    String
  hoursPerWeek Int
  // For REGULAR: one class. For SHARED: two classes. For MATH_GROUP: grade-level.
  classes      Class[]     @relation("ClassLessons")
  grade        Grade?      @relation(fields: [gradeId], references: [id])
  gradeId      String?     // required for MATH_GROUP
  mathLevel    MathLevel?  // only for MATH_GROUP
  entries      ScheduleEntry[]
  restrictions Restriction[]
  createdAt    DateTime    @default(now())
}

model Schedule {
  id        String        @id @default(uuid())
  name      String
  state     ScheduleState @default(DRAFT)
  isStarred Boolean       @default(false)
  entries   ScheduleEntry[]
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
}

model ScheduleEntry {
  id         String    @id @default(uuid())
  schedule   Schedule  @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  scheduleId String
  lesson     Lesson    @relation(fields: [lessonId], references: [id])
  lessonId   String
  day        Day
  slot       Int       // 1–4
  room       Room?     @relation(fields: [roomId], references: [id])
  roomId     String?
  isSeeded   Boolean   @default(false) // immovable by auto-scheduler
  overrides  Override[]
  createdAt  DateTime  @default(now())

  @@unique([scheduleId, lessonId, day, slot]) // a lesson can't be placed twice in same slot
}

model Override {
  id              String        @id @default(uuid())
  entry           ScheduleEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  entryId         String
  restrictionType RestrictionType // which restriction type is overridden
  restrictionId   String?         // specific restriction record if applicable
  note            String?
  createdAt       DateTime      @default(now())
}

model Restriction {
  id        String          @id @default(uuid())
  type      RestrictionType
  tier      RestrictionTier
  // Scope — at least one should be populated for non-structural types
  teacher   Teacher?        @relation(fields: [teacherId], references: [id])
  teacherId String?
  class     Class?          @relation(fields: [classId], references: [id])
  classId   String?
  grade     Grade?          @relation(fields: [gradeId], references: [id])
  gradeId   String?
  lesson    Lesson?         @relation(fields: [lessonId], references: [id])
  lessonId  String?
  subject   Subject?        @relation(fields: [subjectId], references: [id])
  subjectId String?
  // Type-specific parameters
  params    Json            @default("{}")
  note      String?
  isActive  Boolean         @default(true)
  createdAt DateTime        @default(now())
}
```

### Default restrictions seeded on first run
The following restrictions are created automatically when the DB is first initialized:
- B1 (CLASS_NO_WINDOW) for grades 7–10 — Non-negotiable
- B2 (CLASS_MINIMIZE_WINDOWS) for grades 11–12 — Preferred
- B3 (CLASS_NO_SUBJECT_TWICE_PER_DAY) for all classes — Important
- B4 (CLASS_ARTS_BALANCE) for all classes — Important

---

## 3. Auth

### Flow
1. User visits app → redirected to `/auth/google` if not authenticated
2. Google OAuth handshake → callback at `/auth/google/callback`
3. Passport verifies token, checks email domain (`@ankori.edu`)
4. User record created or updated in DB (upsert on googleId)
5. Session established via express-session (stored in Postgres via connect-pg-simple)
6. Redirect to `/` (home)

### Domain restriction
```typescript
// In Passport verify callback:
if (!profile.emails[0].value.endsWith('@ankori.edu')) {
  return done(null, false, { message: 'Unauthorized domain' })
}
```
The allowed domain should be an environment variable (`ALLOWED_EMAIL_DOMAIN`) so it can be changed without a code deploy.

### Session
- Sessions stored in Postgres (`sessions` table, auto-created by connect-pg-simple)
- Session expiry: 30 days (rolling)
- `req.user` available on all authenticated routes

### Middleware
```typescript
requireAuth    // 401 if no session
requireRole(['ADMIN'])   // 403 if wrong role
```

### API endpoints
```
GET  /auth/google              → redirect to Google
GET  /auth/google/callback     → Passport callback → redirect to /
GET  /auth/me                  → { id, name, email, role }
POST /auth/logout              → destroy session → 200
```

---

## 4. Intake & Definitions

All routes require `requireAuth` + `requireRole(['ADMIN'])`.

### 4.1 School Config
One record only. Admin can edit day structure: start time, lesson duration, recess layout.

```
GET  /config       → current SchoolConfig
PUT  /config       → update SchoolConfig
```

UI: A single settings page. Fields: day start time (time picker), lesson duration (number), number of slots (number), recesses (dynamic list — "after slot X, N minutes").

### 4.2 Subjects
```
GET    /subjects         → list all
POST   /subjects         → create { name, isArts, color, specializedRoomId? }
PATCH  /subjects/:id     → update
DELETE /subjects/:id     → delete (guard: not used in any lesson)
```

UI: Table with inline edit. Color picker uses the fixed subject palette from design-spec. "Is Arts" toggle checkbox. "Specialized room" dropdown (optional).

### 4.3 Rooms
```
GET    /rooms         → list all
POST   /rooms         → create { name, capacity }
PATCH  /rooms/:id     → update
DELETE /rooms/:id     → delete (guard: not referenced in any entry)
```

UI: Table with inline edit. Capacity toggle (Standard / Large).

### 4.4 Teachers
```
GET    /teachers         → list all (with subjects)
POST   /teachers         → create { name, subjectIds[] }
PATCH  /teachers/:id     → update
DELETE /teachers/:id     → delete (guard: not used in any lesson)
```

UI: Table. Subject tags shown per teacher. Multi-select for subjects.

### 4.5 Classes & Grades
Classes are auto-generated when the admin sets up the grade config (grades 7–12, 2 classes each = 12 classes). No manual CRUD needed. However, an admin can view and rename classes if needed.

```
GET  /grades         → list grades with their classes
GET  /classes        → list all 12 classes
```

### 4.6 Lessons (Axioms)
The most complex intake form. Three types with different fields.

```
GET    /lessons         → list all (with type, subject, teacher, classes)
POST   /lessons         → create
PATCH  /lessons/:id     → update
DELETE /lessons/:id     → delete (guard: no active schedule entries for this lesson)
```

**POST /lessons body by type:**

Regular:
```json
{ "type": "REGULAR", "subjectId": "...", "teacherId": "...", "classId": "...", "hoursPerWeek": 3 }
```

Shared:
```json
{ "type": "SHARED", "subjectId": "...", "teacherId": "...", "classIds": ["...", "..."], "hoursPerWeek": 1 }
```
> Guard: classIds must be the two classes of the same grade.

Math Group:
```json
{ "type": "MATH_GROUP", "subjectId": "...", "teacherId": "...", "gradeId": "...", "mathLevel": "FIVE_POINT", "hoursPerWeek": 5 }
```
> Guard: subject must be Math. Each grade can have at most one lesson per math level.

UI: Split view — lesson list on left, form on right. Type selector changes the form fields. Math group form shows grade + level; warns if 3-point group doesn't exist for a grade.

### 4.7 Restrictions
```
GET    /restrictions              → list all (filterable by type, tier, teacherId, classId)
POST   /restrictions              → create
PATCH  /restrictions/:id          → update (tier, params, note, isActive)
DELETE /restrictions/:id          → delete
```

UI: Table grouped by category (A, B, C, E). Each row shows: type (human-readable label), tier (color-coded badge), scope (who it applies to), params (human-readable summary), active toggle.

"Add restriction" opens a form:
1. Select category → select type → scope populates (teacher/class/lesson picker based on type) → params fields render dynamically per type → tier selector (default pre-filled) → optional note.

Human-readable restriction labels (important for admin UX):
| Type | Label shown |
|---|---|
| TEACHER_UNAVAILABLE_DAY | {Teacher} is unavailable on {Day} |
| TEACHER_MAX_DAYS_PER_WEEK | {Teacher} teaches at most {N} days/week |
| TEACHER_MIN_DAYS_PER_WEEK | {Teacher} teaches at least {N} days/week |
| CLASS_NO_WINDOW | {Class} must have no mid-day windows |
| CLASS_ARTS_BALANCE | {Class} must have a mix of arts and non-arts each day |
| LESSON_GRADE_SYNC | {Subject} must be scheduled at the same slot for all {Grade} classes |
| ... | ... |

---

## 5. Schedule Management

### 5.1 API
```
GET    /schedules              → list all schedules (id, name, state, isStarred, createdAt, entryCount)
POST   /schedules              → create blank draft { name }
GET    /schedules/:id          → full schedule with all entries + lesson details
PATCH  /schedules/:id          → update { name?, isStarred? }
DELETE /schedules/:id          → delete (guard: not PUBLISHED)
POST   /schedules/:id/publish  → set state=PUBLISHED; un-publish any other schedule
POST   /schedules/:id/clone    → duplicate as new DRAFT with name "{name} (copy)"
```

### 5.2 Home page
Displays all schedules as cards. Layout:
- Published schedule (if any) shown prominently at the top with a green "Published" badge
- Remaining schedules in a grid sorted by last modified
- Each card: name, state badge, star toggle, last modified, lesson count / completion %
- Actions on card: Open, Clone, Delete, Publish (if draft)
- "New schedule" button → creates blank draft → opens editor
- "Run Auto-Scheduler" button → opens AS config modal → runs → opens result in Review Mode

### 5.3 Completion percentage
Calculated as: `(placed entries / total required placements) * 100`

Total required placements = sum of `hoursPerWeek` across all lessons.

---

## 6. Schedule Editor

The core of the product. Accessed at `/schedules/:id/edit`.

### 6.1 Layout (from design spec)
- Sidebar (nav)
- Topbar: schedule name, state badge, warnings button, Review Mode button, Clone, Publish, dark mode toggle
- Stats bar: lessons placed %, violations count, teachers count, constraints OK count
- Day tabs: Sunday–Thursday
- Violations banner (conditional, shown when violations exist)
- Schedule grid (scrollable)
- Subject legend (footer)

### 6.2 Grid structure
- Rows: slots 1–4, with recess rows between them
- Columns: time | 7A | 7B | 8A | 8B | 9A | 9B | 10A | 10B | 11A | 11B | 12A | 12B
- Grade group headers span above each pair
- Time column and header row are sticky

### 6.3 Lesson cards
Each cell can contain:
- A lesson card (lesson placed here)
- An empty cell (drop target / click to add)

Lesson card displays:
- Subject name (Hebrew, RTL)
- Teacher name (Hebrew, RTL)
- Optional tags: math level, shared lesson indicator
- Violation tags (if any restrictions broken)

Card visual state:
- Normal: white bg, subject-colored left border
- Warning: amber left border, amber bg tint, violation tag
- Shared lesson: purple left border
- Seeded (immovable): lock icon, slightly different bg

### 6.4 Drag and drop (@dnd-kit)
- `<DndContext>` wraps the grid
- Each lesson card is a `<Draggable>`
- Each empty cell and each occupied cell is a `<Droppable>`
- On drag start: highlight all valid drop targets (cells that would not create D-category hard invariant violations)
- On drag over a cell: run client-side evaluator → show preview of what violations would result
- On drop:
  1. Run client-side evaluator → collect violations
  2. If violations exist → show ViolationConfirmModal listing them by tier with Override option
  3. Admin confirms (with optional note per violation) or cancels
  4. POST /schedules/:id/entries (or PATCH if moving)
  5. Server runs authoritative evaluation → persists entry + any overrides
  6. Optimistic update in TanStack Query cache

Dropping a card onto an occupied cell: the two lessons **swap** slots.

### 6.5 Unplaced lessons panel
A collapsible panel (or right sidebar) showing all lessons not yet placed for the current day. Admin can drag from here onto the grid.

Actually: since each lesson needs to be placed `hoursPerWeek` times across the week, not per-day, the unplaced panel shows the overall progress. Better UX: a "lesson pool" panel showing all lessons with their placement status (e.g. "Math 9A — placed 2/4").

### 6.6 Entry CRUD API
```
POST   /schedules/:id/entries              → place lesson
  body: { lessonId, day, slot, roomId?, overrides?: [{ restrictionType, restrictionId?, note }] }

PATCH  /schedules/:id/entries/:entryId     → move lesson (swap or relocate)
  body: { day, slot, roomId?, overrides?: [...] }

DELETE /schedules/:id/entries/:entryId     → remove lesson from slot

POST   /schedules/:id/entries/:entryId/override  → add override after the fact
  body: { restrictionType, restrictionId?, note }
```

Server-side on every write:
1. Validate entity references exist
2. Run authoritative evaluator
3. Persist entry
4. Return { entry, violations: EvaluationResult }

---

## 7. Constraint Evaluator Engine

A pure TypeScript module shared between client and server (lives in `shared/`).

### 7.1 Types
```typescript
interface EvaluationInput {
  entries: ScheduleEntry[]
  lessons: Lesson[]
  restrictions: Restriction[]
  config: SchoolConfig
  overrides: Override[]
}

interface Violation {
  restrictionId: string | null  // null for D-category hard invariants
  restrictionType: RestrictionType | 'HARD_INVARIANT'
  tier: RestrictionTier
  message: string               // human-readable, in English
  affectedEntryIds: string[]
  isOverridden: boolean
}

interface EvaluationResult {
  violations: Violation[]
  score: number                 // total penalty (for AS use)
  byTier: Record<RestrictionTier, Violation[]>
}
```

### 7.2 Penalty weights
```typescript
const PENALTY_WEIGHTS: Record<RestrictionTier, number> = {
  NON_NEGOTIABLE: 100_000,
  IMPORTANT:      1_000,
  PREFERRED:      10,
  FLEXIBLE:       1,
}
// Overridden violations contribute 0 to the score.
// D-category hard invariant violations use NON_NEGOTIABLE weight.
```

### 7.3 Evaluator structure
```typescript
function evaluate(input: EvaluationInput): EvaluationResult {
  const violations: Violation[] = []

  // D-category: hard invariants (always evaluated, no restriction record needed)
  violations.push(...evaluateHardInvariants(input))

  // User-configured restrictions
  for (const restriction of input.restrictions.filter(r => r.isActive)) {
    const fn = evaluatorMap[restriction.type]
    if (fn) violations.push(...fn(restriction, input))
  }

  // Mark overrides
  for (const v of violations) {
    v.isOverridden = isOverridden(v, input.overrides)
  }

  const score = violations
    .filter(v => !v.isOverridden)
    .reduce((sum, v) => sum + PENALTY_WEIGHTS[v.tier], 0)

  return { violations, score, byTier: groupByTier(violations) }
}
```

### 7.4 Evaluator implementations (key ones)

**D1 — Teacher double-booked:**
Group entries by (teacherId, day, slot). Any group with count > 1 → violation.

**D2 — Class double-booked:**
Group entries by (classId, day, slot). Any group with count > 1 → violation.

**D3 — Math groups simultaneous:**
For each grade, find all MATH_GROUP entries. Group by (day, slot). If more than one unique (day, slot) exists → violation.

**D5 — Room conflict:**
Group entries by (roomId, day, slot) where roomId is not null. Any group with count > 1 → violation.

**D6 — Specialized room:**
For each entry, check if the lesson's subject has a specializedRoomId. If yes and entry.roomId !== specializedRoomId → violation.

**A1 — Teacher unavailable on day:**
For each entry where entry.lesson.teacherId === restriction.teacherId and entry.day === params.day → violation.

**A5 — Teacher min days per week:**
For teacher, count distinct days with at least one entry. If count < params.min → violation.

**A7 — Teacher max consecutive:**
For each teacher, for each day, get slots in order. Find runs of consecutive filled slots. If any run > params.max → violation.

**A8 — Teacher max window mid-day:**
For each teacher, for each day, get filled slots sorted. Find gaps between consecutive entries. If gap > params.maxSlots → violation.

**B1/B2 — Class windows:**
For each class, for each day, get filled slots. A "window" is a gap between two filled slots (not at end of day). If any window exists → violation for B1. Count windows for B2.

**B4 — Arts balance:**
For each class, for each day, get filled entries. Get their subjects' isArts flag. If all true or all false → violation. (Only triggered if ≥ 2 entries exist for the day.)

**B5 — No subject at edge slots multiple days:**
For each class, for each subject, collect entries at slot 1 or slot N (last slot). Count distinct days. If count > params.maxDays → violation.

**E5 — Grade sync:**
Find the other class in the same grade that has a lesson for the same subject. Check their entries share (day, slot). If not → violation.

---

## 8. Views

All views are read-only filters over the schedule data. They reuse the same LessonCard component.

### 8.1 Teacher View (`/schedules/:id/views/teacher`)
- Dropdown to select teacher
- Grid: rows = days (Sun–Thu), cols = slots (1–4)
- Each cell shows the lesson if that teacher has one there
- Empty cells shown as blank (not droppable — read-only view)

### 8.2 Grade View (`/schedules/:id/views/grade`)
- Dropdown to select grade
- Grid: rows = days, cols = slots, split left/right for class A and B
- Highlights shared lessons (same cell content for both)

### 8.3 Compact View (`/schedules/:id/views/compact`)
- Read-only, printable
- Full schedule, all 5 days, all 12 classes
- Dense layout: smaller cards, subject name only (no teacher shown)
- Strong color-coding by subject (closer to Option B aesthetic — full cell color)
- CSS print styles: hide sidebar, topbar; expand grid to full page width
- "Print / Export PDF" button triggers `window.print()`

---

## 9. Auto-Scheduler

### 9.1 Overview
Algorithm: **Random-restart penalty-minimization with local search** (greedy hill-climbing with random restarts to escape local minima).

The AS always produces output. It never refuses. Bad schedules are shown in Review Mode with full violation breakdown.

### 9.2 API
```
POST /schedules/auto
  body: {
    seedScheduleId?: string   // if provided, copy seeded entries from this schedule
    name: string              // name for the new draft
    config?: {
      nRestarts: number       // default 50
      nIterations: number     // local search iterations per restart; default 1000
    }
  }
  response: { jobId: string }

GET /schedules/auto/jobs/:jobId
  response: {
    status: 'RUNNING' | 'DONE' | 'ERROR'
    progress: number          // 0–100
    scheduleId?: string       // set when DONE
    error?: string
  }
```

### 9.3 Algorithm (server/services/autoscheduler.ts)

Runs in a Node.js **worker thread** to avoid blocking the event loop.

```
function runAutoScheduler(input):
  bestSchedule = null
  bestScore = Infinity

  for restart = 1 to nRestarts:
    entries = [...seededEntries]  // seeded are always kept
    
    // Step 1: expand lessons into instances
    // Each lesson needs hoursPerWeek placements
    lessonInstances = expandLessons(lessons)
    unplaced = lessonInstances.filter(not already covered by seed)
    shuffle(unplaced)  // randomization for different starting points
    
    // Step 2: greedy initial placement
    // Respects D-category hard invariants as much as possible
    // (violations are allowed but penalized heavily)
    for each instance in unplaced:
      slot = randomValidSlot(instance, entries)
      entries.push(slot)
    
    // Step 3: local search (hill climbing)
    for iteration = 1 to nIterations:
      score = evaluate(entries).score
      
      // Pick two random non-seeded entries and try swapping them
      [a, b] = pickTwoRandom(entries.filter(not seeded))
      candidateEntries = swapDaySlot(entries, a, b)
      candidateScore = evaluate(candidateEntries).score
      
      if candidateScore < score:
        entries = candidateEntries  // accept improvement
      
      // Occasionally try a random move instead of swap (avoids plateaus)
      if random() < 0.1:
        entry = pickRandom(entries.filter(not seeded))
        newSlot = randomSlot()
        candidateEntries = moveEntry(entries, entry, newSlot)
        candidateScore = evaluate(candidateEntries).score
        if candidateScore < score:
          entries = candidateEntries
    
    finalScore = evaluate(entries).score
    if finalScore < bestScore:
      bestScore = finalScore
      bestSchedule = entries
    
    reportProgress((restart / nRestarts) * 100)
  
  return bestSchedule
```

### 9.4 Output
When the worker finishes:
1. A new Schedule record is created in DB with state=DRAFT
2. All entries are written to ScheduleEntry
3. Job status is updated to DONE with scheduleId
4. Client polls, gets scheduleId, redirects to Review Mode for the new schedule

### 9.5 Future — Option A (exact solver)
A future endpoint `POST /schedules/auto/exact` will implement a backtracking CSP solver. It runs once, returns the optimal solution or proves no solution exists (given hard constraints). This is architecturally isolated — it uses the same input/output format, same schema.

---

## 10. Review Mode

Accessed at `/schedules/:id/review`. Also the default landing after the AS completes.

### 10.1 UI state
- `isReviewMode: true` in uiStore
- Editing controls hidden: drag disabled, no "+" in empty cells, no entry delete buttons
- Violation panel expanded (right sidebar or bottom drawer)
- Top CTA: "Exit to Edit" (left) and "Publish" (right, primary)

### 10.2 Violation panel
Sections grouped by tier in order: Non-negotiable → Important → Preferred → Flexible.

Each violation shows:
- Icon (🔴 / 🟠 / 🟡 / ⚪)
- Human-readable description (same format as restriction labels)
- "Overridden" badge if applicable (shown but not counted in score)
- Click → scroll to and highlight the affected cell in the grid

Summary at the top of the panel:
```
Schedule score: 14,320 penalty points
● 1 Non-negotiable   ● 3 Important   ○ 2 Preferred   ○ 0 Flexible
```

### 10.3 Publish
- Only available in Review Mode
- Clicking "Publish" → confirmation modal ("This will replace the currently published schedule. Continue?")
- POST /schedules/:id/publish
- On success → redirect to Home, published schedule shown at top

---

## 11. Implementation Phases

Work through these in order. Each phase should be fully working before starting the next.

### Phase 1 — Foundation
- [ ] Initialize monorepo (npm workspaces, root package.json)
- [ ] Scaffold `client/` (Vite + React + TS + Tailwind)
- [ ] Scaffold `server/` (Express + TS)
- [ ] Scaffold `shared/` (types only)
- [ ] Set up Prisma + PostgreSQL connection
- [ ] Run initial migration (full schema from §2)
- [ ] Implement Google OAuth (Passport.js)
- [ ] Session middleware + requireAuth + requireRole
- [ ] Basic React Router setup (pages scaffold, not yet implemented)
- [ ] Tailwind theme config (CSS tokens from design-spec)

### Phase 2 — Definitions
- [ ] School Config API + UI
- [ ] Subjects CRUD API + UI
- [ ] Rooms CRUD API + UI
- [ ] Teachers CRUD API + UI (with subject assignment)
- [ ] Classes/Grades display
- [ ] Lessons CRUD API + UI (all 3 types)
- [ ] Restrictions CRUD API + UI (with dynamic form per type)
- [ ] Seed default restrictions on first run

### Phase 3 — Schedule Core
- [ ] Schedule CRUD API (create, list, get, update, delete, clone, publish)
- [ ] Home page (schedule card list, published highlight)
- [ ] Schedule editor shell (grid renders, no drag yet, data fetched)
- [ ] Stats bar (completion %, counts)
- [ ] Day tabs (Sunday–Thursday)

### Phase 4 — Schedule Editor (Drag & Drop + Validation)
- [ ] Implement shared constraint evaluator (§7)
- [ ] @dnd-kit setup in grid
- [ ] Drag from lesson pool → drop onto empty cell
- [ ] Drag card → move to another cell
- [ ] Drag card → swap with occupied cell
- [ ] Client-side violation preview on drag-over
- [ ] ViolationConfirmModal (with tier display + override notes)
- [ ] POST/PATCH/DELETE entry API endpoints
- [ ] Override persistence
- [ ] Violations banner (live count)

### Phase 5 — Views
- [ ] Teacher View page
- [ ] Grade View page
- [ ] Compact View page + print styles

### Phase 6 — Auto-Scheduler
- [ ] Worker thread scaffolding
- [ ] Lesson instance expansion
- [ ] Initial random placement
- [ ] Local search (swap + move)
- [ ] Multi-restart loop
- [ ] Job tracking (in-memory Map)
- [ ] POST /schedules/auto + GET /schedules/auto/jobs/:jobId
- [ ] Client: AS config modal + progress polling UI
- [ ] On complete: create DRAFT schedule → redirect to Review Mode

### Phase 7 — Review Mode
- [ ] isReviewMode state in uiStore
- [ ] Edit controls hidden in review mode
- [ ] Violation panel (grouped by tier, clickable)
- [ ] Scroll-to-entry on violation click
- [ ] Publish flow + confirmation modal

### Phase 8 — Polish
- [ ] Dark mode persistence (localStorage)
- [ ] Error boundaries + user-friendly error states
- [ ] Loading skeletons for grid + lists
- [ ] Empty states (no schedules, no teachers, etc.)
- [ ] Form validation (Zod on server, matching client-side)
- [ ] RTL rendering audit (all Hebrew content renders correctly)
- [ ] Keyboard accessibility basics (tab order, escape to close modals)

---

## 12. Key Decisions & Notes for Implementation

- **Hebrew content is always RTL at the element level** (`dir="rtl"` on card text), never at the page level. The grid layout is LTR.
- **The evaluator is the single source of truth.** Client-side evaluation is for UX preview only. The server always runs the authoritative evaluation before persisting.
- **Optimistic updates** should be used in the editor for snappiness — update the TanStack Query cache immediately on drop, roll back if the server rejects.
- **MATH_GROUP lessons block an entire grade's time slot.** When placing a MATH_GROUP entry, treat it as occupying slots for all students in the grade (both classes). The D3 evaluator enforces this.
- **Shared lessons count as one entry** (one ScheduleEntry record, two classIds on the Lesson). Both classes appear occupied in the grid for that slot.
- **The AS runs once per job.** There is no streaming of partial schedules. Client shows a progress bar (0–100%) while polling.
- **Only one schedule can be PUBLISHED at a time.** The publish endpoint un-publishes any currently published schedule atomically in a Prisma transaction.
- **Seeded entries from a previous schedule** are copied by the AS endpoint (not referenced). The new schedule is fully independent.
- **Room assignment is auto + overridable.** When a lesson is placed (manually or by AS), a room is auto-assigned: (1) specialized room if the subject requires one, (2) a free LARGE room for SHARED lessons, (3) any free STANDARD+ room otherwise. The admin can click the room chip on any lesson card to override the assignment via a dropdown of free rooms for that slot. Room assignment is never blocking — if no room is available the entry is placed without one and flagged as a warning.
