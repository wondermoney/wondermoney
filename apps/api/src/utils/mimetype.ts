const supportedMimetypes: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const fromMimetypeToExtension = (mimetype: string) => {
  if (!Object.keys(supportedMimetypes).includes(mimetype)) throw Error('Unsupported mimetype');
  return supportedMimetypes[mimetype];
};
