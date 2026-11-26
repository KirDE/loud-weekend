import { rockEnSeineLifecycleSource } from "./adapters/rock-en-seine-hiatus.ts";

/** Trusted source allowlist, not supplied by HTTP clients or stored proposals. */
export function lifecycleSource(parserVersion: string) {
  const source = [rockEnSeineLifecycleSource].find(
    (source) => source.parserVersion === parserVersion,
  );
  if (!source) throw new Error("Unsupported lifecycle parser");
  return source;
}
