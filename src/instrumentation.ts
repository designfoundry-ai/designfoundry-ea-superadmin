export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb } = await import('./lib/db-init');
    await initDb().catch(err => {
      console.error('[db-init] failed:', err);
    });
  }
}
