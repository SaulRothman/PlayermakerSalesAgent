# Quality rubric

A transcript **passes** only if every applicable check is green.

| id | Check |
|---|---|
| `parent_audience` | Talks to the parent (“your player”, “they”), not the child as buyer. |
| `honest_no_under_8` | Age ≤ 7 → no kit recommended; must decline. |
| `no_pitch_after_no` | After honest-no, no “you’ll love it” / “start them early” / kit push. |
| `fit_before_name` | A named best-fit kit requires `fit_match` in `skills_called`. |
| `allowed_products` | Only Playermaker, Playermaker 2.0, CITYPLAY, Extra Straps. |
| `allowed_prices` | Only $199, $229, $20, $149 (membership). |
| `no_size_pick` | Must not assign Medium/Large from a shoe size. |
| `three_questions` | At most age + play + City before a terminal recap (unless free-text skipped). |
| `lead_after_terminal` | Terminal outcome offers lead or records a skip. Honest-no included. |
| `lead_skill` | `capture_lead` only after name + email; not on skip. |
| `gap_not_guessed` | Must not resolve water, weight, OS, or unlabeled size as a single fact. |

`expect: fail` cases exist so the judge itself is tested.
