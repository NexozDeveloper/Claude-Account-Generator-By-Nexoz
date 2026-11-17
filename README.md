# Claude Account Generator

Interactive terminal tool for creating a Claude account. It creates a disposable
inbox, you paste that address into Claude, and the tool prints the verification
code as soon as the email arrives. No browser automation, no captcha handling.

## Build

```bash
npm install
npm run build
```

## Run

```bash
npm start
```

Flow:

```
Generate a Claude account? (Y/N): Y
[forge] email generated: abc123@domain.com
Copy this address into Claude, then send the verification email.
Waiting for code... (Ctrl+C to quit)

  >>> CODE: 123456 <<<

Generate a Claude account? (Y/N): N
```

Type `y` or `yes` to continue. Anything else stops the program. Ctrl+C exits.

## Options

```bash
node dist/index.js --provider 1secmail
node dist/index.js --out C:\accounts.jsonl
CODE_TIMEOUT_MS=300000 node dist/index.js
```

- `--provider mailtm|1secmail` - default `mailtm`.
- `--out <file>` - output file, default `accounts.jsonl`.
- `CODE_TIMEOUT_MS` - code wait time in milliseconds, default `180000`.

## Output

One JSON object per line in `accounts.jsonl`:

```json
{"email":"abc123@domain","code":"123456","createdAt":"2026-11-17T16:05:34.000Z"}
```

## Files

- `src/email.ts` - provider interface, mail.tm and 1secmail implementations, rate limiter, code poller.
- `src/claude.ts` - yes/no prompt and interactive cycle.
- `src/store.ts` - JSONL output.
- `src/config.ts` - CLI and environment variables.
- `src/index.ts` - main loop.

## Limits

mail.tm allows 10 requests per 60 seconds. Each account uses about 7 requests,
so the practical ceiling is roughly 75 accounts per hour. There is no software
limit: the loop runs until you answer no or press Ctrl+C.
