import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  listMyOpenPullRequests,
  readPullRequestStack,
  readPullRequests
} from '../../github/pr-manager/pr-manager-reads'
import { PR_MANAGER_ADDED_MAX } from '../../../shared/github/pr-manager/pr-manager-list'

const segment = z.string().regex(/^[A-Za-z0-9_.-]+$/)
const refSchema = z.object({
  host: z
    .string()
    .regex(/^[a-z0-9.-]+(:\d+)?$/i)
    .optional(),
  owner: segment,
  repo: segment,
  number: z.number().int().positive()
})
const positive = z.number().int().positive()

export function registerGitHubPRManagerHandlers(): void {
  ipcMain.handle('gh:prManagerListMine', (_event, args: unknown) => {
    const parsed = z
      .object({ first: positive.max(100).optional(), after: z.string().nullish() })
      .parse(args ?? {})
    return listMyOpenPullRequests(parsed)
  })
  ipcMain.handle('gh:prManagerRead', (_event, args: unknown) => {
    const { refs } = z.object({ refs: z.array(refSchema).max(PR_MANAGER_ADDED_MAX) }).parse(args)
    return readPullRequests(refs)
  })
  ipcMain.handle('gh:prManagerStack', (_event, args: unknown) => {
    const parsed = z
      .object({
        ref: refSchema,
        stack: z.object({ number: positive, position: positive, size: positive })
      })
      .parse(args)
    return readPullRequestStack(parsed)
  })
}
