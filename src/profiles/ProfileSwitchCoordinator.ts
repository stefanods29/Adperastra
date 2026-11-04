/** The host side of a controlled profile restart (Step 10c T5, E4).
 *
 * Order is fixed: dirty decisions, finish or cancel jobs, lock every
 * sensitive container, flush sessions/recovery/settings, make `pending_id`
 * durable, then request the restart. Any refusal before the restart leaves
 * the current profile and its files usable; a failed commit never restarts.
 */
import {
  commitProfileSwitch as nativeCommitProfileSwitch,
  isCanonicalProfileId,
  prepareProfileSwitch as nativePrepareProfileSwitch,
  type ProfileSwitchPlan,
} from "../services/profiles";

export interface ProfileSwitchDependencies {
  /** Ask the 09a/09h dirty coordinator; false means "cancel". */
  confirmDirty: () => Promise<boolean>;
  /** A snapshot of unfinished shared jobs. */
  activeJobIds: () => Promise<readonly string[]>;
  /** Cancel those jobs; true when the caller may re-check and continue. */
  cancelJobs: (ids: readonly string[]) => Promise<boolean>;
  /** Lock every 09k sensitive container before leaving the profile. */
  lockSensitiveContainers: () => Promise<void>;
  /** Flush sessions, recovery and settings through their atomic writers. */
  flushState: () => Promise<void>;
  /** Ask the shell to restart; only called after a durable pending id. */
  requestRestart: () => Promise<void>;
  /** Test seams; production uses the native commands. */
  prepare?: (targetId: string) => Promise<ProfileSwitchPlan>;
  commit?: (planId: string) => Promise<void>;
  nowUnix?: () => number;
}

export class ProfileSwitchCoordinator {
  private readonly deps: ProfileSwitchDependencies;
  private readonly prepare: (targetId: string) => Promise<ProfileSwitchPlan>;
  private readonly commit: (planId: string) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: ProfileSwitchDependencies) {
    this.deps = deps;
    this.prepare = deps.prepare ?? nativePrepareProfileSwitch;
    this.commit = deps.commit ?? nativeCommitProfileSwitch;
    this.now = deps.nowUnix ?? (() => Math.floor(Date.now() / 1000));
  }

  /** True when the user saved or discarded everything, or nothing was dirty. */
  prepareDirty(): Promise<boolean> {
    return this.deps.confirmDirty();
  }

  /** True when no job is left running. A cancelled job must settle first. */
  async quiesceJobs(): Promise<boolean> {
    const active = await this.deps.activeJobIds();
    if (active.length === 0) return true;
    const stopped = await this.deps.cancelJobs(active);
    if (!stopped) return false;
    const remaining = await this.deps.activeJobIds();
    return remaining.length === 0;
  }

  lockSensitive(): Promise<void> {
    return this.deps.lockSensitiveContainers();
  }

  flushState(): Promise<void> {
    return this.deps.flushState();
  }

  restart(): Promise<void> {
    return this.deps.requestRestart();
  }

  /**
   * Run the whole controlled switch. Returns false only when the user
   * cancelled at the dirty decision; every other refusal is an error and the
   * caller stays on the current profile.
   */
  async switchTo(targetId: string): Promise<boolean> {
    if (!isCanonicalProfileId(targetId)) {
      throw new Error("profiles.invalid");
    }
    if (!(await this.prepareDirty())) return false;
    if (!(await this.quiesceJobs())) throw new Error("profiles.busy");
    await this.lockSensitive();
    // A failed flush must reach the caller before any pending catalog write.
    await this.flushState();
    const plan = await this.prepare(targetId);
    if (plan.target_id !== targetId) throw new Error("profiles.changed");
    if (plan.expires_unix < this.now()) throw new Error("profiles.changed");
    // The pending id is durable when this resolves; only then restart.
    await this.commit(plan.plan_id);
    await this.restart();
    return true;
  }
}
