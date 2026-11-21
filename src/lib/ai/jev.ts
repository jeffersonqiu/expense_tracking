import type { Decider } from "./types";

/**
 * Jev (TypeSafe) via OpenRouter.
 *
 * Not implemented yet: the request/response format of OpenRouter's Jev
 * "Decisions API" could not be read from the build environment, and we don't
 * guess API shapes. Until it is filled in, `makeDecider` falls back to Haiku.
 * See docs/ARCHITECTURE.md §7.
 */
export function makeJevDecider(): Decider | null {
  return null;
}
