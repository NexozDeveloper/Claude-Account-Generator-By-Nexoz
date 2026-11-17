import process from "node:process";
import { closePrompt, handleInterrupt, runCycle } from "./claude.js";
import { loadConfig } from "./config.js";
import { createProvider } from "./email.js";
import { logger } from "./logger.js";
import { Store } from "./store.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const provider = createProvider(cfg.provider);
  const store = new Store(cfg.outputFile);

  console.log("=========================================");
  console.log("  Claude Account Generator - By Nexoz");
  console.log("=========================================");
  logger.info("forge", `provider=${provider.name} output=${store.filePath}`);
  process.once("SIGINT", handleInterrupt);

  try {
    let keepGoing = true;
    while (keepGoing) {
      keepGoing = await runCycle(provider, cfg, store);
    }
  } finally {
    closePrompt();
    logger.info("forge", "bye");
  }
}

main().catch((err: unknown) => {
  closePrompt();
  logger.error("forge", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});