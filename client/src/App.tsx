/**
 * App — root router definition.
 *
 * Route structure:
 *   /login                     — unauthenticated landing
 *   / (AuthGuard)
 *     /                        — HomePage (schedule list)
 *     /schedules/:id           — ScheduleEditorPage
 *     /definitions/config      — ConfigPage
 *     /definitions/subjects    — SubjectsPage
 *     /definitions/rooms       — RoomsPage
 *     /definitions/teachers    — TeachersPage
 *     /definitions/lessons     — LessonsPage
 *     /definitions/restrictions — RestrictionsPage
 *     /views/teacher           — TeacherViewPage
 *     /views/grade             — GradeViewPage
 *     /views/compact           — CompactViewPage
 *
 * AuthGuard shows a spinner while checking session and redirects
 * unauthenticated users to /login.
 */

import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthGuard } from './components/layout/AuthGuard'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { ScheduleEditorPage } from './pages/ScheduleEditorPage'
import { ConfigPage } from './pages/definitions/ConfigPage'
import { SubjectsPage } from './pages/definitions/SubjectsPage'
import { RoomsPage } from './pages/definitions/RoomsPage'
import { TeachersPage } from './pages/definitions/TeachersPage'
import { LessonsPage } from './pages/definitions/LessonsPage'
import { RestrictionsPage } from './pages/definitions/RestrictionsPage'
import { TeacherViewPage } from './pages/views/TeacherViewPage'
import { GradeViewPage } from './pages/views/GradeViewPage'
import { CompactViewPage } from './pages/views/CompactViewPage'
import { ImportPage } from './pages/ImportPage'

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected — each route wrapped in its own ErrorBoundary so a crash
          on one page doesn't take down the rest of the app */}
      <Route
        path="/*"
        element={
          <AuthGuard>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/schedules/:id" element={<ScheduleEditorPage />} />

                {/* Definitions */}
                <Route path="/definitions/config" element={<ConfigPage />} />
                <Route path="/definitions/subjects" element={<SubjectsPage />} />
                <Route path="/definitions/rooms" element={<RoomsPage />} />
                <Route path="/definitions/teachers" element={<TeachersPage />} />
                <Route path="/definitions/lessons" element={<LessonsPage />} />
                <Route path="/definitions/restrictions" element={<RestrictionsPage />} />

                {/* Views */}
                <Route path="/views/teacher" element={<TeacherViewPage />} />
                <Route path="/views/grade" element={<GradeViewPage />} />
                <Route path="/views/compact" element={<CompactViewPage />} />

                {/* Import */}
                <Route path="/import" element={<ImportPage />} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </AuthGuard>
        }
      />
    </Routes>
  )
}
