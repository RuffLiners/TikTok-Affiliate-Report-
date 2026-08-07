// Brand configuration — set NEXT_PUBLIC_BRAND_NAME in your environment
// (Vercel → Settings → Environment Variables) to white-label the dashboard.
// Falls back to a neutral name if not set.
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'My Brand'
