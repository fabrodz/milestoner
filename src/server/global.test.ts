import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeJsonAtomic } from "../util/fs.js";
import { iso } from "../util/time.js";
import { claimPanel, ensureGlobalPanel, findLivePanel, panelInfoPath, releasePanel, type PanelInfo } from "./global.js";
import { createPanel } from "./http.js";

const TOKEN = "machine-panel-token";

function freshHome(): void {
  process.env.MILESTONER_HOME = mkdtempSync(join(tmpdir(), "milestoner-panel-home-"));
}

function infoOf(pid: number, port: number): PanelInfo {
  return { pid, port, token: TOKEN, startedAt: iso() };
}

/** A real machine panel on an ephemeral port, so the probe has something to answer it. */
async function livePanel(): Promise<{ port: number; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "milestoner-panel-reg-"));
  const server = createPanel({
    scope: { kind: "machine", registry: join(dir, "runs.json"), projects: join(dir, "projects.json"), cliPath: "" },
    port: 0,
    token: TOKEN,
    allowWrites: false,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

test("an empty machine directory is claimed, and the claim is what findLivePanel finds", async () => {
  freshHome();
  const panel = await livePanel();
  try {
    const mine = infoOf(process.pid, panel.port);
    assert.equal(await claimPanel(mine), true);
    assert.deepEqual(await findLivePanel(), mine);
  } finally {
    panel.close();
  }
});

test("a claim defers to a panel that is alive and answering", async () => {
  freshHome();
  const panel = await livePanel();
  try {
    writeJsonAtomic(panelInfoPath(), infoOf(process.pid, panel.port));
    const challenger = infoOf(999_999, panel.port);
    assert.equal(await claimPanel(challenger), false);
    assert.equal((await findLivePanel())?.pid, process.pid, "the sitting panel keeps its file");
  } finally {
    panel.close();
  }
});

test("a live pid that does not answer is a recycled number, and the claim goes through", async () => {
  freshHome();
  // process.pid is alive, but nothing serves on this port: exactly the stale-entry-after-reboot shape.
  const dead = await livePanel();
  dead.close();
  writeJsonAtomic(panelInfoPath(), infoOf(process.pid, dead.port));
  assert.equal(await findLivePanel(), null, "an entry nobody answers for is not a live panel");

  const panel = await livePanel();
  try {
    const mine = infoOf(process.pid, panel.port);
    assert.equal(await claimPanel(mine), true, "the pid alone must not defend the entry");
    assert.equal((await findLivePanel())?.port, panel.port);
  } finally {
    panel.close();
  }
});

test("a dead pid never defends its entry", async () => {
  freshHome();
  const panel = await livePanel();
  try {
    writeJsonAtomic(panelInfoPath(), infoOf(999_999, panel.port));
    assert.equal(await claimPanel(infoOf(process.pid, panel.port)), true);
  } finally {
    panel.close();
  }
});

test("release is ownership-checked, like the state lock", async () => {
  freshHome();
  writeJsonAtomic(panelInfoPath(), infoOf(process.pid, 1));
  releasePanel(999_999);
  assert.equal(existsSync(panelInfoPath()), true, "someone else's release must not delete our entry");
  releasePanel(process.pid);
  assert.equal(existsSync(panelInfoPath()), false);
});

test("ensure finds the live panel without spawning, and without a CLI path spawns nothing", async () => {
  freshHome();
  const panel = await livePanel();
  try {
    writeJsonAtomic(panelInfoPath(), infoOf(process.pid, panel.port));
    const ensured = await ensureGlobalPanel({ cliPath: "", port: 4400, write: true });
    assert.equal(ensured?.spawned, false);
    assert.equal(ensured?.info.port, panel.port);
  } finally {
    panel.close();
  }
  const nothing = await ensureGlobalPanel({ cliPath: "", port: 4400, write: true });
  assert.equal(nothing, null, "no live panel and no CLI to spawn means none");
});
