# The Board

_Be careful what you wish for, because it might come true._

The Board is an open-source feature board web app. You can propose features and vote on
them.

There's one twist, though: Twice a day--at noon and at midnight UTC--the top-voted
feature is automatically implemented on The Board itself.

What will you make of The Board? There's only one way to find out.

## Feature implementation rules

- Every shipped feature must record or refresh its end-to-end test reference so we know what keeps it stable in production.
- When a new page or flow lands, extend the accessibility regression suite (see `e2e/test_accessibility.py`) so HTML, CSS, and semantics keep validating.
- Keep the voting path intact — CAPTCHA is always required and voting basics must stay green in the API smoke tests.
