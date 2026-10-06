/** Only deliberate, user-facing domain errors may cross a Server Action boundary. */
export class PublicActionError extends Error {}

export function actionError(error: unknown, fallback: string): string {
  return error instanceof PublicActionError ? error.message : fallback;
}
