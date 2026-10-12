export async function slack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) { console.error('SLACK_WEBHOOK_URL not set; message was:\n' + text); return }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
  if (!res.ok) console.error(`Slack post failed: ${res.status}`)
}
