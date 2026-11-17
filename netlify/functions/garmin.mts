// Stažení připraveného tréninku pro Garmin: /garmin/<token>, odkaz platí 24 hodin.
import { BlobStore } from '../../src/connector/blobStore';
import { handleFile } from '../../src/connector/http';

export default async (_req: Request, context: { params: Record<string, string | undefined> }) =>
  handleFile(context.params.token, new BlobStore());

export const config = { path: '/garmin/:token' };
