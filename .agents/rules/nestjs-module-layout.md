# NestJS module folder layout

Scope: `vibe-system-design-backend/src/`. Follow these rules whenever you add,
move, rename, or review files under that folder.

## What a module folder holds

- One feature lives in one folder: `src/<module>/`.
- The module root holds: `*.module.ts`, the controller, the service, the
  repository interface and its Drizzle implementation, stateful helper classes,
  shared types, DTOs, constants, and their spec files.
- A spec file always sits next to the file it tests.

## What a util file is

- A util file contains stateless functions. It holds no NestJS class and no
  `@Injectable` decorator.
- A class earns its place only when it holds state across calls, like
  `RunRecorder` or `DrizzleChatRepository`. Do not wrap a plain function in a
  class. Class decoration adds work and buys nothing without state.

## Where a util file goes

Place the file by domain coupling, not by caller count.

- It imports no module-specific type, table, or config → `src/utils/<name>.ts`.
- It imports module-specific types, or encodes module keys or prefixes →
  `src/<module>/utils/<name>.ts`.

Judge coupling from the code of the file. One caller today does not make a
generic file module-specific. Ten callers do not make a module file generic.

Examples from `src/chat`:

- `src/utils/sse.ts` — formats SSE frames, imports no chat type.
- `src/utils/cut-title.ts` — cuts a plain string, imports no chat type.
- `src/chat/utils/id.ts` — builds `ses_` and `msg_` ids for chat tables.
- `src/chat/utils/history.ts` — maps chat rows to LangChain messages.

## Additional rules

- New util files go straight into the right utils folder. Never add a util file
  to a module root.
- Name a util file for its function, with no module prefix: `cut-title.ts`, not
  `chat.title.ts`.
- `src/utils/` must not import from a feature module. If a shared file needs a
  module type, it is not shared. Move it into `<module>/utils/`.
- Search for an existing helper before you write one. Keep one implementation
  per concept in the codebase.
- Move the spec file together with its source file in the same commit.
