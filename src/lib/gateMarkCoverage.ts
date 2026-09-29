// The gate-mark check (#558): every layer ahead of a contract route's handler
// must say what it is — a gate stamp (`markGate`) or a `markNotGate` mark with
// its reason.
//
// The contract derives a route's 401/403/429 from its gate stamps (#517), so a
// real gate nobody stamped is simply invisible to it. #509 F7 was that shape:
// `forumTopicNote.ts` defined its own `requireModerator`, which answered 403
// and was never stamped, and the contract described two routes as unable to
// answer 403. Before derivation, the hand-written 403 at least disagreed with
// the stamps and CI noticed; after it, nothing did.
//
// `readGate` cannot see an unstamped function by construction, so this inverts
// the burden instead of guessing at which functions enforce: a layer carrying
// neither mark fails. There is no baseline, because none was needed when this
// landed.
//
// Pure: the CLI in scripts/check-gate-marks.ts hands it the real app's routes.
import { isContractRoute, type Operation } from './openapiCompleteness';

export interface GateMarkResult {
  ok: boolean;
  /** `METHOD /path: <layer>` for every unmarked layer, sorted. */
  unmarked: string[];
  /** Contract routes inspected, for the report. */
  routes: number;
}

export const checkGateMarks = (
  routes: readonly Operation[]
): GateMarkResult => {
  const contract = routes.filter(isContractRoute);
  const unmarked = contract
    .flatMap((route) =>
      (route.unmarked ?? []).map(
        (layer) => `${route.method} ${route.path}: ${layer}`
      )
    )
    .sort();
  return { ok: unmarked.length === 0, unmarked, routes: contract.length };
};

export const formatGateMarkReport = (result: GateMarkResult): string => {
  if (result.ok) {
    return `${result.routes} contract routes; every layer ahead of a handler is marked.`;
  }
  return [
    `${result.unmarked.length} layer(s) ahead of a contract route's handler carry neither mark:`,
    ...result.unmarked.map((line) => `  ${line}`),
    '',
    'Each must say what it is (src/lib/routeGate.ts):',
    '  - it can refuse the request: stamp it with markGate(fn, kind), so the contract derives the code;',
    "  - it cannot, or the refusal is site-wide: markNotGate(fn, 'why it is not a gate')."
  ].join('\n');
};
