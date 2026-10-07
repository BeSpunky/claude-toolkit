// THE UPGRADE'S ATTENTION LIST — what a generator needs a HUMAN to look at once the run is over.
//
// A generator's `logger.warn` lands in the middle of an upgrade's output: hundreds of lines of migrations, installs
// and generator chatter, which nobody reads back once `UPGRADE_OK` prints. A value the upgrade replaced in a
// project's own target (an edit lost, a contract re-asserted, a target left the project's own) is exactly what must
// not drown there. So such a line is also handed to house.sh, which prints every one of them under
// `UPGRADE_ATTENTION` in its final summary — the part of the output a human (and /bespunky-house:upgrade) reads.
//
// The channel is a FILE house.sh names in `BESPUNKY_UPGRADE_REPORT` (inside its self-ignoring upgrade lock, so it
// survives the run's Docker boundary and vanishes with the lock). Outside an upgrade — a bare `nx g`, a test — the
// variable is unset and the log line is the whole report.
import { appendFileSync } from 'node:fs';
import { logger } from '@nx/devkit';

export const UPGRADE_REPORT_ENV = 'BESPUNKY_UPGRADE_REPORT';

/** Say `line` now (a warning), and put it on the upgrade's attention list when one is being kept. */
export function reportToUpgrade(who: string, line: string): void {
  const said = `[${who}] ${line.replace(/\s*\n\s*/g, ' ')}`;
  logger.warn(said);
  const file = process.env[UPGRADE_REPORT_ENV];
  if (!file) return;
  try {
    appendFileSync(file, `${said}\n`);
  } catch {
    // The warning above still said it; an unwritable list must not fail the generator.
  }
}
