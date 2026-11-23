import type { PrManagerRef } from './pr-manager-types'

const GITHUB_DOT_COM = 'github.com'
const SEGMENT = /^[A-Za-z0-9_.-]+$/

/** The PR a pasted GitHub link names, or null when the text is anything but one PR link. */
export function parsePullRequestUrl(text: string): PrManagerRef | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) {
    return null
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  // Tabs such as /files or /checks, and a trailing slash, still name the PR.
  const [owner, repo, kind, rawNumber] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repo || kind !== 'pull' || !rawNumber || !/^\d+$/.test(rawNumber)) {
    return null
  }
  const number = Number(rawNumber)
  if (!Number.isSafeInteger(number) || number <= 0 || !SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return {
    ...(host === GITHUB_DOT_COM ? {} : { host: url.port ? `${host}:${url.port}` : host }),
    owner,
    repo,
    number
  }
}

export function pullRequestRefUrl(ref: PrManagerRef): string {
  return `https://${ref.host ?? GITHUB_DOT_COM}/${ref.owner}/${ref.repo}/pull/${ref.number}`
}

/** Owner and repo names are case-insensitive on GitHub, so two spellings are one PR. */
export function pullRequestRefKey(ref: PrManagerRef): string {
  return `${ref.host ?? GITHUB_DOT_COM}/${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase()
}
