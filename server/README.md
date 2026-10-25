# varnum-api

Accounts, saved-letter sync and private usage counts for Varnum. Runs on Jarvis (Node + PostgreSQL), port 8103,
served at https://varnum-api.alvvintechnology.com. The website itself is static and runs on Friday.

- `scripts/setup-db.sh` (once, with sudo on Jarvis): creates the `varnum` database and role and writes
  `/srv/sites/VarnumApi/.env` (`PORT`, `HOST`, `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`).
  Optional: `ORIGINS` (comma separated) if the site moves; default is the Varnum site and the Android app.
- Backups: the nightly `jarvis-backup` job dumps every PostgreSQL database, this one included.
- Admin page: https://varnum-api.alvvintechnology.com/ (HTTP basic auth) shows accounts and daily usage.

What is stored: name, email, a scrypt password hash, letterhead details, saved letters (only when the user
presses Save letter), and per-day counts of which features were used. Letter text is never counted or logged.

## Better translation: the open Sarvam Translate model (optional)

`POST /api/translate {text, target}` answers only when `LLM_URL` is set. It points at a local
[llama.cpp](https://github.com/ggml-org/llama.cpp) server running the open
[Sarvam Translate](https://huggingface.co/sarvamai/sarvam-translate) model (22 Indian languages, based on Gemma 3 4B).
Without it, the endpoint returns 503 and the website uses its free translators as before.

On Jarvis (CPU only, about 3 GB RAM, roughly 3 to 5 seconds per line):

1. Build llama.cpp CPU-only, `-DGGML_CUDA=OFF` (`cmake -B build && cmake --build build -j --target llama-server llama-quantize`).
2. Get a GGUF of the model. Jarvis uses the ready `sarvam-translate.Q4_K_M.gguf` from
   [mradermacher/sarvam-translate-GGUF](https://huggingface.co/mradermacher/sarvam-translate-GGUF). Or convert it yourself:
   `python convert_hf_to_gguf.py <sarvam-translate folder> --outfile sarvam-translate-f16.gguf`, then
   `llama-quantize sarvam-translate-f16.gguf sarvam-translate-Q4_K_M.gguf Q4_K_M`.
3. Run it as a service bound to localhost, for example a systemd unit `varnum-llm`:
   `llama-server -m /srv/data/models/sarvam-translate-Q4_K_M.gguf --host 127.0.0.1 --port 8105 -t 8 -c 4096 --jinja -ngl 0`
   (run as user `varnum-llm` with `CUDA_VISIBLE_DEVICES=` so the GPU stays free; port 8104 is used by another service)
4. Add `LLM_URL=http://127.0.0.1:8105` to `/srv/sites/VarnumApi/.env` and restart `site-varnumapi`.
5. Check: `curl -s -H 'Content-Type: application/json' -d '{"text":"Please look into this matter.","target":"hi"}' http://127.0.0.1:8103/api/translate`

The API runs one translation at a time, keeps the last 5,000 answers in memory, and turns requests away (503 "busy")
when more than 6 are waiting, so the website falls back instead of making people wait.
