import process from "node:process";

export type EmailProviderName = "mailtm" | "1secmail";

export interface Config {
  provider: EmailProviderName;
  outputFile: string;
  codeTimeoutMs: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function valueOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadConfig(): Config {
  const providerRaw = (valueOf("--provider") ?? process.env.EMAIL_PROVIDER ?? "mailtm").toLowerCase();
  return {
    provider: providerRaw === "1secmail" ? "1secmail" : "mailtm",
    outputFile: valueOf("--out") ?? process.env.OUTPUT_FILE ?? "accounts.jsonl",
    codeTimeoutMs: intEnv("CODE_TIMEOUT_MS", 180000),
  };
}