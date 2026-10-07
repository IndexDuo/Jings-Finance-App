/** pg connection-string SSL fields override an explicit ssl object. Remove
 * those fields when supplying the CA through a hosting environment variable. */
export function databaseConnectionOptions(connectionString: string, ca = process.env.DATABASE_SSL_CA) {
  if (!ca) return { connectionString };
  const url = new URL(connectionString);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslpassword", "ssl"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true } };
}
