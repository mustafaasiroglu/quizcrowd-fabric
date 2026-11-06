export function sqlConfiguration(serverValue: string, databaseValue: string) {
  const server = serverValue.trim().replace(/,1433$/, '');
  const database = databaseValue.trim();
  if (!server || server.startsWith('<') || server.includes(',') ||
      !database || database.startsWith('<')) {
    throw new Error('Configure the private Fabric SQL server and database in app secrets.');
  }
  return { server, database };
}
