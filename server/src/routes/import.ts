/**
 * XLSX import routes
 *
 * POST /api/import/xlsx/preview  — parse the file, return what WOULD be created (no DB writes)
 * POST /api/import/xlsx/execute  — parse + write subjects/teachers/lessons to DB
 *
 * Both endpoints accept multipart/form-data with field name "file".
 */

import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { previewImport, executeImport } from '../services/xlsxImporter'

export const importRouter = Router()

// Memory storage — we only need the buffer, never touch the disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },  // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
               file.mimetype.includes('excel') ||
               file.originalname.endsWith('.xlsx') ||
               file.originalname.endsWith('.xls')
    cb(null, ok)
  },
})

importRouter.post(
  '/xlsx/preview',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded.' })
        return
      }
      const preview = await previewImport(req.file.buffer)
      res.json(preview)
    } catch (err) { next(err) }
  },
)

importRouter.post(
  '/xlsx/execute',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded.' })
        return
      }
      const result = await executeImport(req.file.buffer)
      res.json(result)
    } catch (err) { next(err) }
  },
)
