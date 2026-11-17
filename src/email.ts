import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "./logger.js";

export interface Inbox {
  readonly address: string;
  waitForCode(pattern: RegExp | RegExp[], timeoutMs: number): Promise<string>;
  dispose(): Promise<void>;
}

export interface EmailProvider {
  readonly name: string;
  createInbox(): Promise<Inbox>;
}

class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  async wait(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0]!;
      await sleep(this.windowMs - (now - oldest) + 250);
    }
  }
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToSearchableText(html: string): string {
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]).join("\n");
  return `${stripHtml(html)}\n${links}`;
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super("provider rate limit (429)");
    this.name = "RateLimitError";
  }
}

function collection<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const member = (body as Record<string, unknown>)["hydra:member"];
    if (Array.isArray(member)) return member as T[];
  }
  return [];
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? Math.min(seconds, 30) : null;
}

export function extractCode(text: string, pattern: RegExp): string | null {
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  if (!m) return null;
  const groups = m.slice(1).filter(Boolean);
  return groups.length > 0 ? groups.join("") : m[0];
}

export const CODE_PATTERNS: RegExp[] = [
  /\b(\d{6})\b/,
  /\b(\d{3})[\s\-]?(\d{3})\b/,
  /[?&](?:code|token|otp)=([A-Za-z0-9_-]{6,12})/i,
  /\b(?:code|verification|verify)[^A-Za-z0-9]{0,30}([A-Za-z0-9]{6,8})\b/i,
];

const POLL_INTERVAL_MS = 5000;

async function pollForCode(
  label: string,
  timeoutMs: number,
  fetchMessages: () => Promise<Array<{ id: string; subject: string }>>,
  readBody: (id: string) => Promise<string>,
  pattern: RegExp | RegExp[],
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const seen = new Set<string>();
  let lastErr: unknown;
  let backoffMs = POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    let limited = false;
    try {
      const messages = await fetchMessages();
      backoffMs = POLL_INTERVAL_MS;
      for (const msg of messages) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        const body = await readBody(msg.id);
        const haystack = `${msg.subject}\n${body}`;
        for (const candidate of patterns) {
          const code = extractCode(haystack, candidate);
          if (code) return code;
        }
        logger.debug(label, `message ${msg.id} had no code - body: ${body.slice(0, 300)}`);
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof RateLimitError) {
        limited = true;
        backoffMs =
          err.retryAfterSeconds !== null
            ? err.retryAfterSeconds * 1000 + 500
            : Math.min(backoffMs * 2, 15000);
      }
      logger.debug(label, `poll error: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(limited ? backoffMs : POLL_INTERVAL_MS);
  }

  const detail = lastErr instanceof Error ? ` (last: ${lastErr.message})` : "";
  throw new Error(`${label}: no verification code within ${timeoutMs}ms${detail}`);
}

interface MailTmMessage {
  id: string;
  subject: string;
  from?: { address?: string };
  text?: string | null;
  html?: string[] | string | null;
}

export class MailTmProvider implements EmailProvider {
  readonly name = "mailtm";

  private readonly limiter = new RateLimiter(9, 60_000);
  private cachedDomain?: string;

  constructor(private readonly apiBase = "https://api.mail.tm") {}

  private async request(
    path: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    await this.limiter.wait();
    return fetch(`${this.apiBase}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        "user-agent": "claude-account-generator/2.1",
        accept: "application/json",
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
  }

  private async pickDomain(): Promise<string> {
    if (this.cachedDomain) return this.cachedDomain;
    const res = await this.request("/domains");
    if (res.status === 429) throw new RateLimitError(retryAfter(res));
    if (!res.ok) throw new Error(`mail.tm domains: HTTP ${res.status}`);
    const body = await res.json();
    const domains = collection<{ domain: string }>(body).map((d) => d.domain).filter(Boolean);
    if (domains.length === 0) throw new Error("mail.tm: no domains available");
    this.cachedDomain = domains[Math.floor(Math.random() * domains.length)]!;
    return this.cachedDomain;
  }

  async createInbox(): Promise<Inbox> {
    const domain = await this.pickDomain();
    const address = `${randomString(14)}@${domain}`;
    const password = randomString(20);

    const created = await this.request("/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, password }),
    });
    if (created.status === 429) throw new RateLimitError(retryAfter(created));
    if (!created.ok && created.status !== 201) {
      throw new Error(`mail.tm account create: HTTP ${created.status} ${await created.text()}`);
    }

    const tokenRes = await this.request("/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, password }),
    });
    if (tokenRes.status === 429) throw new RateLimitError(retryAfter(tokenRes));
    if (!tokenRes.ok) throw new Error(`mail.tm token: HTTP ${tokenRes.status}`);
    const token = ((await tokenRes.json()) as { token: string }).token;
    if (!token) throw new Error("mail.tm: empty token");

    const self = this;
    const authHeaders = { authorization: `Bearer ${token}` };

    return {
      address,
      async waitForCode(pattern, timeoutMs) {
        return pollForCode(
          "mailtm",
          timeoutMs,
          async () => {
            const res = await self.request("/messages?limit=20", { headers: authHeaders });
            if (res.status === 429) throw new RateLimitError(retryAfter(res));
            if (!res.ok) throw new Error(`mail.tm messages: HTTP ${res.status}`);
            const messages = collection<MailTmMessage>(await res.json());
            if (messages.length === 0) logger.debug("mailtm", "inbox empty");
            return messages.map((m) => ({ id: m.id, subject: m.subject ?? "" }));
          },
          async (id) => {
            const res = await self.request(`/messages/${encodeURIComponent(id)}`, { headers: authHeaders });
            if (res.status === 429) throw new RateLimitError(retryAfter(res));
            if (!res.ok) throw new Error(`mail.tm message ${id}: HTTP ${res.status}`);
            const msg = (await res.json()) as MailTmMessage;
            if (msg.text) return stripHtml(msg.text);
            const html = Array.isArray(msg.html) ? msg.html.join(" ") : (msg.html ?? "");
            return htmlToSearchableText(html);
          },
          pattern,
        );
      },
      async dispose() {
        try {
          await self.request(`/accounts/${encodeURIComponent(address)}`, {
            method: "DELETE",
            headers: authHeaders,
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          void 0;
        }
      },
    };
  }
}

interface SecMailMessage {
  id: number;
  subject: string;
  from?: string;
}

export class OneSecMailProvider implements EmailProvider {
  readonly name = "1secmail";

  constructor(private readonly apiBase = "https://www.1secmail.com/api/v1") {}

  async createInbox(): Promise<Inbox> {
    const res = await fetch(`${this.apiBase}/?action=genRandomMailbox&count=1`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`1secmail generate: HTTP ${res.status}`);
    const list = (await res.json()) as string[];
    const address = list[0];
    if (!address || !address.includes("@")) throw new Error("1secmail: bad mailbox response");
    const at = address.indexOf("@");
    const login = address.slice(0, at);
    const domain = address.slice(at + 1);

    const apiBase = this.apiBase;
    const qs = `login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`;

    return {
      address,
      async waitForCode(pattern, timeoutMs) {
        return pollForCode(
          "1secmail",
          timeoutMs,
          async () => {
            const r = await fetch(`${apiBase}/?action=getMessages&${qs}`, {
              signal: AbortSignal.timeout(15000),
            });
            if (r.status === 429) throw new RateLimitError(retryAfter(r));
            if (!r.ok) throw new Error(`1secmail getMessages: HTTP ${r.status}`);
            const msgs = (await r.json()) as SecMailMessage[];
            return msgs.map((m) => ({ id: String(m.id), subject: m.subject ?? "" }));
          },
          async (id) => {
            const r = await fetch(`${apiBase}/?action=readMessage&${qs}&id=${encodeURIComponent(id)}`, {
              signal: AbortSignal.timeout(15000),
            });
            if (r.status === 429) throw new RateLimitError(retryAfter(r));
            if (!r.ok) throw new Error(`1secmail readMessage: HTTP ${r.status}`);
            const msg = (await r.json()) as { body?: string; textBody?: string; htmlBody?: string };
            return msg.textBody
              ? stripHtml(msg.textBody)
              : htmlToSearchableText(msg.htmlBody ?? msg.body ?? "");
          },
          pattern,
        );
      },
      async dispose() {
        void 0;
      },
    };
  }
}

export function createProvider(name: string): EmailProvider {
  return name === "1secmail" ? new OneSecMailProvider() : new MailTmProvider();
}