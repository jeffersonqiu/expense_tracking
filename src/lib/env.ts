/** Centralised env access; throws early with a clear message when missing. */
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => need("NEXT_PUBLIC_SUPABASE_URL"),
  publishableKey: () => need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  secretKey: () => need("SUPABASE_SECRET_KEY"),
  openRouterKey: () => process.env.OPENROUTER_API_KEY || null,
  cronSecret: () => need("CRON_SECRET"),
};
