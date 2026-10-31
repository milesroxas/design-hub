// The fidelity ceiling's rules, named exactly as the headings in
// .claude/skills/miles-prototype/SKILL.md, and the Noul each semantic rule
// asks. The guard asks all four on a write; the pre-flight asks the states
// one over each sprint prototype before a share link goes out.

export const RULE = {
  gravity: 'Low gravity',
  fork: "Fork, don't flex",
  dependency: 'No new dependency without the user',
  fetching: 'Fixtures, never a backend',
  abstraction: 'No abstraction for later',
  handling: 'No handling a fixture cannot reach',
  state: 'Every state is in the README',
} as const;

export type SemanticRule = 'fetching' | 'abstraction' | 'handling' | 'state';

/** Each question reads `change`, `readmeStates` and `fixtureSets` from the state by path. */
export const NOULS: Record<SemanticRule, string> = {
  fetching:
    'Does the code in `change` introduce data fetching, persistence or a backend call: fetch, XMLHttpRequest, WebSocket, IndexedDB, a server module, or localStorage used as a database rather than as a prototype preference?',
  abstraction:
    'Does the code in `change` introduce an abstraction (a custom hook, a React context, a generic or higher-order component, a utility module) that only one place uses?',
  handling:
    'Does the code in `change` add error handling, loading state or input validation for a case that none of the fixture sets in `fixtureSets` would exercise?',
  state: 'Does the code in `change` render a user-visible UI state that is not listed in `readmeStates`?',
};
