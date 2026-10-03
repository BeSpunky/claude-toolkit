// The workflow plugin's one hooks module: a plugin names a single module in hooks.json,
// so each mod lives in its own file and is registered here.
import type { Register } from 'claude-code'
import { register as branchStatus } from './branch-status.ts'
import { register as checkpointToast } from './checkpoint-toast.ts'
import { register as standing } from './standing.tsx'

export const register: Register = (on, options) => {
  branchStatus(on, options)
  checkpointToast(on, options)
  standing(on, options)
}
