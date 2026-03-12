import { Logger } from "next-axiom";

// Module-level logger — Axiom batches and flushes per request.
// Call logger.flush() (via after()) at the end of each API route.
const _log = new Logger({ source: "server" });

export const logger = {
  debug: (msg: string, fields?: object) => _log.debug(msg, fields),
  info: (msg: string, fields?: object) => _log.info(msg, fields),
  warn: (msg: string, fields?: object) => _log.warn(msg, fields),
  error: (msg: string, fields?: object) => _log.error(msg, fields),
  flush: () => _log.flush(),
};
