import { RequestContext } from '@mikro-orm/core';
import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';

import { BadRequestError } from '@utils/errors';

const OCR_UPLOAD_ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const upload = multer({
  fileFilter: (_req, file, cb) => {
    if (!OCR_UPLOAD_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new BadRequestError('Only .jpg, .jpeg, .png, .webp and .pdf formats are supported.'));
      return;
    }

    cb(null, true);
  },
  limits: {
    fields: 0,
    files: 1,
    fileSize: 5_000_000,
    parts: 1,
  },
});

function mapMulterError(error: unknown): Error {
  if (!(error instanceof MulterError)) return error as Error;

  switch (error.code) {
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new BadRequestError('Invalid OCR upload payload.');
    case 'LIMIT_FILE_SIZE':
      return new BadRequestError('Max file size is 5MB.');
    default:
      return new BadRequestError('Invalid OCR upload payload.');
  }
}

function multerSingleFile(req: Request, res: Response, next: NextFunction): Response | void {
  // This is necessary so that we have access to the mikro-orm EntityManager
  // in subsequent methods after this middleware. Since multer clears the context,
  // we need to set it after with the one existing previously
  // @see https://github.com/mikro-orm/mikro-orm/discussions/5759
  const em = RequestContext.getEntityManager();
  if (em === undefined) { next(); return; }

  upload.single('file')(req, res, (error) => {
    RequestContext.create(em, () => {
      if (error) {
        next(mapMulterError(error));
        return;
      }

      next();
    });
  });
}

export default multerSingleFile;
