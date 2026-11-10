---
paths:
  - "contract/**"
  - "modules/*/contract.ts"
---

# Contract

- Everything here crosses the wire as JSON: plain objects, arrays, strings, numbers, booleans and
  `null`. No classes, functions, `Date`, `Map` or `Set`; a moment is epoch milliseconds.
- `hello`, `welcome` and `shutdown` (`contract/src/protocol.ts`) never change shape: they let any
  version of the app replace any version of the service.
- Names are owner-prefixed: the core's `agents.*`, `chat.*`, `settings.*` and so on, a module's
  `<module>.*`. Commands are verbs, events say what happened.
- A module's types live in its own `contract.ts` and join the maps by augmentation;
  `contract/src/index.ts` re-exports each module's contract and nothing else of it.
- The core contract is agent-neutral (ADR-006): no Agent SDK or other Claude-only types.
