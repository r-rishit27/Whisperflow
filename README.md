# Whisperflow

Voice-to-text tooling built on OpenAI speech-to-text with Supabase for persistence.

> **Status:** early scaffold. The repository structure and tooling are in place; the
> application code is not written yet.

## Getting started

```bash
git clone https://github.com/r-rishit27/whisperflow.git
cd whisperflow
cp .env.example .env   # then fill in your own keys
```

## Configuration

All configuration is read from environment variables. See [.env.example](.env.example)
for the full list.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Speech-to-text requests |
| `SUPABASE_URL` | yes | Supabase project endpoint |
| `SUPABASE_ANON_KEY` | yes | Client-side Supabase access |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Server-side access; never ship to a client |

`.env` is gitignored. Keep real keys out of commits, and rotate anything that leaks.

## Layout

```
.
├── .env.example          # template for local configuration
├── .github/workflows/ci.yml
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE)
