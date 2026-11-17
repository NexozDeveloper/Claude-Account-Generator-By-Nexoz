import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

export interface AccountRecord {
  email: string;
  code: string;
  createdAt: string;
}

export class Store {
  private readonly path: string;
  private initialized = false;

  constructor(outputFile: string) {
    this.path = resolve(process.cwd(), outputFile);
  }

  private async ensure(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.path), { recursive: true });
    this.initialized = true;
  }

  async save(email: string, code: string): Promise<void> {
    await this.ensure();
    const record: AccountRecord = { email, code, createdAt: new Date().toISOString() };
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  get filePath(): string {
    return this.path;
  }
}