# Agent playbooks + scripts (Phase 5)

This folder is the brain’s written source. Phase 6 pastes it into DevRev Agent Studio.
It does **not** run in the browser and it does **not** replace the catalog API.

| Path | What it is |
|---|---|
| `playbooks/` | Decision logic: persona, 3 questions, honesty check, when to call a skill, honest-no, leads, gaps |
| `scripts/` | Exact copy. Do not paraphrase product facts. |
| `INSTRUCTIONS.md` | Single paste pack for Agent Studio (playbooks + script pointers) |
| `eval/` | Quality judge + golden / fail cases |

## Run the judge

```bash
.venv/bin/python agent/eval/judge.py
```

Goldens must pass. `expect: fail` cases must fail. Exit 1 if the suite drifts.

## Phase 6

- Load `INSTRUCTIONS.md` as the agent persona/instructions.
- Register skills 220–223 against a **public** catalog URL (not `localhost:3001`).
- Keep the page contract (`web/src/lib/agent-protocol.ts`) unchanged.
- Re-run this judge against real agent transcripts before publish.
