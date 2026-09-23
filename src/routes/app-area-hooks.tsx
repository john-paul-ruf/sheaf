/**
 * The app area's shared plumbing (M54): the wiring every app route receives,
 * and the reads that turn S03's relationship RPCs into the view models
 * SHT-002, SHT-003 and the records list render (CAP-24). Kept beside the route table rather than inside it so
 * each piece is one hook with one job.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  selectReferencePickerVm,
  selectTableSwitcherVm,
  type RecordFormFieldVm,
  type ReferencePickerVm,
  type TableSwitcherVm,
} from "../application/view-models/records.js";
import type { RecordsServices } from "../application/workflows/records-services.js";
import type { AppIdentity, AppNavigation } from "../ui/records/app-frame.js";
import type {
  AppSessionViewV1,
  AppTableViewV1,
  RecordPageViewV1,
  RecordReferenceViewV1,
} from "../workers/protocol/messages.js";
import { TableSwitcherSheet } from "../ui/records/table-switcher-sheet.js";
import { hashHref, tablePath } from "./guards.js";

/**
 * What every app-area route is given: the open app, where its surfaces live,
 * the worker edge, and the two things a write needs — a way to say what
 * happened once it is durable, and a way to have the app re-read.
 */
export interface AppAreaWiring {
  readonly identity: AppIdentity;
  readonly nav: AppNavigation;
  readonly records: RecordsServices;
  readonly session: AppSessionViewV1;
  readonly topBarActions: ReactNode;
  readonly announce: (sentence: string) => void;
  readonly refresh: () => void;
}

/**
 * CTL-059 + SHT-003. The trigger reads the session's counts; opening the
 * sheet re-reads them (`listTables`), because a count shown as a choice has
 * to be the count now, not the one from when the app was opened.
 */
export function useTableSwitcher(input: {
  readonly records: RecordsServices;
  readonly appId: string;
  readonly tables: readonly AppTableViewV1[];
  readonly currentTableId: string | null;
}): {
  readonly vm: TableSwitcherVm | undefined;
  readonly open: (() => void) | undefined;
  readonly overlay: ReactNode;
} {
  const { records, appId, tables, currentTableId } = input;
  const [isOpen, setIsOpen] = useState(false);
  const [fresh, setFresh] = useState<readonly AppTableViewV1[] | null>(null);

  const open = useCallback(() => {
    setIsOpen(true);
    void records.listTables({ appId }).then(
      ({ tables: read }) => {
        setFresh(read);
      },
      () => {
        setFresh(null);
      },
    );
  }, [records, appId]);

  if (tables.length < 2) {
    return { vm: undefined, open: undefined, overlay: null };
  }
  const vm = selectTableSwitcherVm(fresh ?? tables, currentTableId);
  return {
    vm,
    open,
    overlay: (
      <TableSwitcherSheet
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
        }}
        tableHref={(tableId) => hashHref(tablePath(appId, tableId))}
        vm={vm}
      />
    ),
  };
}

/**
 * Each listed record's reference fields, resolved or broken (CA-21), read
 * once per page. A table with no reference field asks nothing.
 */
export function useListReferences(input: {
  readonly records: RecordsServices;
  readonly appId: string;
  readonly table: AppTableViewV1 | undefined;
  readonly pages: readonly RecordPageViewV1[] | null;
}): ReadonlyMap<string, readonly RecordReferenceViewV1[]> {
  const { records, appId, table, pages } = input;
  const [references, setReferences] = useState<
    ReadonlyMap<string, readonly RecordReferenceViewV1[]>
  >(new Map());

  const hasReferenceField =
    table?.fields.some((field) => field.type.kind === "reference") === true;

  useEffect(() => {
    if (!hasReferenceField || pages === null) return undefined;
    let live = true;
    const wanted = pages
      .flatMap((page) => page.records.map((record) => record.recordId))
      .filter((recordId) => !references.has(recordId));
    if (wanted.length === 0) return undefined;
    void Promise.all(
      wanted.map(async (recordId) => {
        const { related } = await records.getRelatedRecords({ appId, recordId });
        return [recordId, related?.parents ?? []] as const;
      }),
    ).then(
      (read) => {
        if (!live) return;
        setReferences((current) => new Map([...current, ...read]));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [records, appId, pages, hasReferenceField, references]);

  return references;
}

/** SHT-002's search for one field: the worker's candidates, as the sheet's view. */
export function referenceSearchFor(
  records: RecordsServices,
  appId: string,
  field: Pick<RecordFormFieldVm, "fieldId" | "displayName">,
  currentRecordId: string | null,
): (query: string) => Promise<ReferencePickerVm> {
  return async (query) => {
    const { candidates } = await records.searchReferenceCandidates({
      appId,
      fieldId: field.fieldId,
      text: query,
    });
    return selectReferencePickerVm({
      fieldName: field.displayName,
      query,
      current:
        currentRecordId === null ? null : { kind: "pending", recordId: currentRecordId },
      candidates,
    });
  };
}
