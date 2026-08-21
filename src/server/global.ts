import { spawn } from "node:child_process";
import { join } from "node:path";
import { withStateLock } from "../lock.js";
import { machineDir } from "../paths.js";
import { isProcessAlive } from "../pulse.js";
import { readJsonIfExists, removeIfExists, writeJsonAtomic } from "../util/fs.js";
import { sleep } from "../util/time.js";

export const PANEL_FILE = "panel.json";

/** How the machine panel is found: one file beside the registry, owned by whoever serves it. */
export interface PanelInfo {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

export function panelInfoPath(): string {
  return join(machineDir(), PANEL_FILE);
}

export function panelUrl(info: PanelInfo): string {
  return `http://127.0.0.1:${info.port}/?token=${info.token}`;
}

/**
 * Does the entry describe a panel that actually answers? A live pid is not enough - pids are reused,
 * and unlike the registry (D-025) there is no per-project pulse to corroborate this one. The panel
 * itself is the corroborating witness: it is an HTTP server, so ask it.
 */
export async function panelAnswers(info: PanelInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/state`, {
      headers: { authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function findLivePanel(): Promise<PanelInfo | null> {
  const info = readJsonIfExists<PanelInfo>(panelInfoPath());
  if (!info || typeof info.pid !== "number" || typeof info.port !== "number" || !isProcessAlive(info.pid)) return null;
  return (await panelAnswers(info)) ? info : null;
}

/**
 * Record this process as the machine panel, or lose to one that already is. Two runs starting at
 * once spawn two daemons; the lock makes one of them the panel and the other exits.
 *
 * The probe runs before the lock because fetch cannot run inside a sync critical section. That
 * leaves one seam: an entry whose pid is alive is only overridden when it is the exact entry the
 * probe saw fail, so a daemon that registered between our probe and our lock is never clobbered.
 */
export async function claimPanel(mine: PanelInfo): Promise<boolean> {
  const probed = readJsonIfExists<PanelInfo>(panelInfoPath());
  const probedAnswers = probed && isProcessAlive(probed.pid) ? await panelAnswers(probed) : false;
  try {
    return withStateLock(machineDir(), () => {
      const current = readJsonIfExists<PanelInfo>(panelInfoPath());
      if (current && current.pid !== mine.pid && isProcessAlive(current.pid)) {
        const probedDead = probed !== null && probed.pid === current.pid && probed.port === current.port && !probedAnswers;
        if (!probedDead) return false;
      }
      writeJsonAtomic(panelInfoPath(), mine);
      return true;
    });
  } catch {
    // Best-effort like every machine-level write: an unclaimable panel file must not stop a panel.
    return false;
  }
}

/** Ownership-checked, like lock release: never delete an entry a newer panel has since written. */
export function releasePanel(pid: number): void {
  try {
    withStateLock(machineDir(), () => {
      const current = readJsonIfExists<PanelInfo>(panelInfoPath());
      if (current?.pid === pid) removeIfExists(panelInfoPath());
    });
  } catch {
    // best-effort
  }
}

export interface EnsuredPanel {
  info: PanelInfo;
  /** True when this call started the daemon, which is when the browser is worth opening. */
  spawned: boolean;
}

export interface EnsurePanelOptions {
  /** Absolute path to this CLI, so the daemon is relaunched exactly as the user installed it. */
  cliPath: string;
  port: number;
  write: boolean;
}

/**
 * The runner's side of the machine panel: find the live one, or spawn the daemon and wait for it to
 * claim `panel.json`. Detached for the same reason `startRun` spawns detached - the panel must not
 * die with the run that happened to be first, that is its whole point.
 */
export async function ensureGlobalPanel(options: EnsurePanelOptions): Promise<EnsuredPanel | null> {
  const live = await findLivePanel();
  if (live) return { info: live, spawned: false };
  if (!options.cliPath) return null;

  const args = [options.cliPath, "serve", "--all", "--auto-exit", "--port", String(options.port)];
  if (options.write) args.push("--write");
  try {
    spawn(process.execPath, args, { detached: true, stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch {
    return null;
  }

  for (let i = 0; i < 40; i += 1) {
    await sleep(0.25);
    const found = await findLivePanel();
    if (found) return { info: found, spawned: true };
  }
  return null;
}

/**
 * Open the panel without writing the key into the browser. D-027 refused --open because the URL is
 * the credential; the answer here is a single-use link: the panel mints a short-lived once-token,
 * the browser exchanges it at /auth for a cookie, and what history keeps is a link that is already
 * dead. See D-032.
 */
export async function openPanel(info: PanelInfo): Promise<boolean> {
  let once: string;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/once`, {
      method: "POST",
      headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    once = ((await res.json()) as { once: string }).once;
  } catch {
    return false;
  }

  const url = `http://127.0.0.1:${info.port}/auth?once=${once}`;
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
