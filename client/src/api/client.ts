/**
 * Axios instance shared by all API modules.
 *
 * - Sends cookies (`withCredentials`) so the session cookie is included.
 * - Base URL is blank so Vite's `/api` proxy forwards requests to Express.
 * - Throws on non-2xx by default (Axios behaviour); callers can catch and
 *   surface errors to TanStack Query's `error` field.
 */

import axios from 'axios'

const apiClient = axios.create({
  baseURL: '',          // Vite proxy: /api → http://localhost:3001
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

export default apiClient
