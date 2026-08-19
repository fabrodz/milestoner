import type { AgentConfig, DogwatchConfig } from "./types.js";

export interface AgentSlot {
  agent: AgentConfig;
  name: string;
  /** Epoch ms before which this agent must not be launched again. 0 means available now. */
  availableAt: number;
}

export interface AgentPool {
  slots: AgentSlot[];
  index: number;
}

/**
 * The primary agent plus its fallbacks, as one rotation. A run with no fallbacks is a pool of one,
 * which behaves exactly as the engine did before rotation existed: bench the only agent, wait for it.
 */
export function createPool(config: DogwatchConfig): AgentPool {
  const slots = [config.agent, ...config.fallbackAgents].map((agent, i) => ({
    agent,
    name: agent.name ?? (i === 0 ? agent.command : `${agent.command}#${i}`),
    availableAt: 0,
  }));
  return { slots, index: 0 };
}

export function currentAgent(pool: AgentPool): AgentSlot {
  return pool.slots[pool.index]!;
}

export function hasFallbacks(pool: AgentPool): boolean {
  return pool.slots.length > 1;
}

export interface Rotation {
  /** The agent to launch next. Always set: a pool of one rotates back onto itself. */
  next: AgentSlot;
  /** True when `next` is a different agent than the one that just failed. */
  switched: boolean;
  /** How long to sleep before launching `next`. Zero whenever another agent is already free. */
  waitSeconds: number;
}

/**
 * Bench the agent that just failed for `coolSeconds` and choose who runs next.
 *
 * A usage limit passes the seconds until the announced reset, so the agent comes back exactly when
 * its quota does rather than being written off for the rest of the run. Waiting is the last resort:
 * an agent that is free right now is always preferred over sleeping, which is the whole point of
 * configuring a fallback in the first place.
 */
export function benchAndRotate(pool: AgentPool, coolSeconds: number, now: number = Date.now()): Rotation {
  const failed = currentAgent(pool);
  failed.availableAt = Math.max(failed.availableAt, now + coolSeconds * 1000);

  // Round-robin from the one after the failure, so a pool of three does not always retry the same
  // fallback first.
  for (let step = 1; step < pool.slots.length; step += 1) {
    const candidate = (pool.index + step) % pool.slots.length;
    if (pool.slots[candidate]!.availableAt <= now) {
      pool.index = candidate;
      return { next: pool.slots[candidate]!, switched: true, waitSeconds: 0 };
    }
  }

  // Everyone is cooling down: sleep for the shortest of them and resume there.
  let soonest = 0;
  for (let i = 1; i < pool.slots.length; i += 1) {
    if (pool.slots[i]!.availableAt < pool.slots[soonest]!.availableAt) soonest = i;
  }
  const switched = soonest !== pool.index;
  pool.index = soonest;
  const slot = pool.slots[soonest]!;
  return { next: slot, switched, waitSeconds: Math.max(0, Math.ceil((slot.availableAt - now) / 1000)) };
}
