/** The Node secret key from the environment: `LUCIDA_SECRET_KEY`, else the older `LUCIDA_KEY`. */
export const envKey = (): string | undefined =>
  typeof process !== "undefined" ? process.env.LUCIDA_SECRET_KEY || process.env.LUCIDA_KEY || undefined : undefined;
