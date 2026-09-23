/**
 * The structure column's routes (M54; CA-07 amendment 4, D63; CAP-35).
 *
 * Kept beside the route table, like the chart and snapshot routes. The
 * structure is read from the worker on arrival and again whenever the app
 * re-reads (`session` changes after a confirmed write), so a screen never
 * shows a schema from before the change it just applied.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import { selectStructureVm, type StructureSelection } from "../application/view-models/schema.js";
import type { AppStructureViewV1 } from "../workers/protocol/messages.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { StructureScreen } from "../ui/schema/structure-screen.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { appPath } from "./guards.js";

type StructureState =
  | { readonly kind: "reading" }
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly structure: AppStructureViewV1 };

/** The app's structure, re-read after every confirmed write. */
function useStructure(area: AppAreaWiring): StructureState {
  const { schema, identity, session } = area;
  const appId = identity.appId;
  const [state, setState] = useState<StructureState>({ kind: "reading" });
  useEffect(() => {
    let live = true;
    void schema.getAppStructure({ appId }).then(
      ({ structure }) => {
        if (live) setState(structure === null ? { kind: "absent" } : { kind: "read", structure });
      },
      () => {
        if (live) setState({ kind: "absent" });
      },
    );
    return () => {
      live = false;
    };
  }, [schema, appId, session]);
  return state;
}

/** SCR-035 at `#/app/{id}/structure`. */
export function StructureRoute({
  area,
  notice,
  clearNotice,
}: {
  readonly area: AppAreaWiring;
  /** A confirmed change's sentence, said once on arrival. */
  readonly notice?: string;
  readonly clearNotice: () => void;
}): ReactNode {
  const { identity, nav, topBarActions } = area;
  const state = useStructure(area);
  const [selection, setSelection] = useState<StructureSelection>({ tableId: null, fieldId: null });
  // Said once: leaving the structure forgets the sentence.
  useEffect(() => clearNotice, [clearNotice]);

  if (state.kind === "reading") {
    return <BusyIndicator cancellation="unavailable" label="Reading this app's structure on this device." />;
  }
  if (state.kind === "absent") {
    // The app is open and its structure is not readable; its home is what is true.
    return <Navigate replace to={appPath(identity.appId)} />;
  }
  const vm = selectStructureVm(state.structure, selection);
  return (
    <StructureScreen
      app={identity}
      nav={nav}
      onSelectField={(fieldId) => {
        setSelection({ tableId: vm.table?.tableId ?? null, fieldId });
      }}
      onSelectTable={(tableId) => {
        setSelection({ tableId, fieldId: null });
      }}
      topBarActions={topBarActions}
      vm={vm}
      {...(notice === undefined ? {} : { announcement: notice })}
    />
  );
}
