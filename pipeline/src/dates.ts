export const laToday = (): string => process.env.ASOF || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
