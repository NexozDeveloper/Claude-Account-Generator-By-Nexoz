import { createInterface } from "node:readline/promises";
import process from "node:process";
import type { Config } from "./config.js";
import { CODE_PATTERNS, type EmailProvider } from "./email.js";
import { logger } from "./logger.js";
import { Store } from "./store.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function normalize(answer: string): string {
  return answer.trim().toLowerCase();
}

export async function askYesNo(question: string): Promise<boolean> {
  const answer = normalize(await rl.question(`${question} (Y/N): `));
  return answer === "y" || answer === "yes";
}

export async function runCycle(provider: EmailProvider, cfg: Config, store: Store): Promise<boolean> {
  if (!(await askYesNo("\nGenerate a Claude account?"))) return false;

  const inbox = await provider.createInbox();
  logger.ok("forge", `email generated: ${inbox.address}`);
  console.log("Copy this address into Claude, then send the verification email.");
  console.log("Waiting for code... (Ctrl+C to quit)");

  try {
    const code = await inbox.waitForCode(CODE_PATTERNS, cfg.codeTimeoutMs);
    console.log(`\n  >>> CODE: ${code} <<<\n`);
    await store.save(inbox.address, code);
    logger.ok("forge", `code saved to ${store.filePath}`);
  } catch (err) {
    logger.error("forge", err instanceof Error ? err.message : String(err));
    const manual = normalize(
      await rl.question("Did you receive the code? (Enter to skip, or type the code): "),
    );
    if (manual) {
      await store.save(inbox.address, manual);
      logger.ok("forge", `manual code saved to ${store.filePath}`);
    }
  } finally {
    await inbox.dispose().catch(() => undefined);
  }
  return true;
}

export function closePrompt(): void {
  rl.close();
}

export function handleInterrupt(): void {
  console.log("\n");
  logger.info("forge", "bye");
  closePrompt();
  process.exit(130);
}
