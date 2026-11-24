import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  RowSelectionState,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
  ColumnOrderState,
  Row,
  RowModel,
  Table,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Task,
  TaskPriority,
  TaskStatusDisplay,
  mapTaskStatusToBackend,
} from "../types";
import { ProcessFieldDto } from "../services/processService";
import { generateDynamicColumns } from "../utils/columnGenerator";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
import {
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Search,
  Filter as FilterIcon,
  Columns,
  Plus,
  Trash2,
  X,
  Eye,
  EyeOff,
  GripVertical,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Bookmark,
  Download,
  Copy,
  TrendingUp,
  HelpCircle
} from 'lucide-react';
import { useTaskViewPersistence } from "../hooks/useTaskViewPersistence";
import { TaskView } from "../services/userFilterService";

/** Status filter a fresh grid opens with (was applied by an effect before). */
const DEFAULT_STATUS_FILTER = ["Pending", "In Progress", "On Hold"];

/** Outside the component on purpose: the persistence hook uses it as a dependency. */
const DEFAULT_VIEW: TaskView = {
  search: "",
  filters: { status: DEFAULT_STATUS_FILTER },
  sorting: [],
  columnVisibility: {},
  columnOrder: [],
  quickFilter: "all",
  completedDateFilter: null,
  v: 1,
};

const toFilterMap = (filters: ColumnFiltersState): Record<string, unknown> =>
  Object.fromEntries(filters.map((f) => [f.id, f.value]));

const fromFilterMap = (map: Record<string, unknown> | undefined): ColumnFiltersState =>
  Object.entries(map ?? {}).map(([id, value]) => ({ id, value }));

const stringFilterFn = (row: any, columnId: string, filterValue: any) => {
  const value = row.getValue(columnId);
  if (value == null) return false;

  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) return true;
    const selected = filterValue.map((v) => String(v).toLowerCase());
    return selected.includes(String(value).toLowerCase());
  }

  return String(value)
    .toLowerCase()
    .includes(String(filterValue).toLowerCase());
};
stringFilterFn.autoRemove = (val: any) =>
  val == null || (Array.isArray(val) && val.length === 0) || val === "";

const globalDeepSearchFn = (
  row: any,
  _columnId: string,
  filterValue: string,
): boolean => {
  if (!filterValue || filterValue.trim() === "") return true;
  const needle = filterValue.trim().toLowerCase();
  const original = row.original as Task;

  const topLevelMatch = [
    "status",
    "priority",
    "assignedUser",
    "id",
    "title",
    "description",
    "referenceNumber",
    "comments",
  ].some((key) => {
    const val = (original as any)[key];
    return val != null && String(val).toLowerCase().includes(needle);
  });
  if (topLevelMatch) return true;

  if (original.taskData) {
    return Object.values(original.taskData).some((val) => {
      if (val == null) return false;
      if (Array.isArray(val))
        return val.some((v) => String(v).toLowerCase().includes(needle));
      return String(val).toLowerCase().includes(needle);
    });
  }
  return false;
};
globalDeepSearchFn.autoRemove = (val: any) => !val || val.trim() === "";

interface TaskTableProps {
  data: Task[];
  processFields?: ProcessFieldDto[];
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onSilentUpdateTask: (id: string, updates: Partial<Task>) => void;
  onBulkUpdate: (ids: string[], updates: Partial<Task>) => void;
  onDuplicateTask?: (sourceTask: Task, direction: "above" | "below") => void;
  addToast: (message: string, type: "success" | "error" | "info") => void;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
  hasMore?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onAddTask?: () => void;
  onSearchChange?: (searchTerm: string) => void;
  totalCount?: number;
  onExport?: (params: {
    fromDate: string;
    toDate: string;
    status: "" | "Pending" | "In Progress" | "Completed";
    format: "csv" | "xlsx";
  }) => Promise<void> | void;
  isExporting?: boolean;
  processId?: string | number;
  /** Logged-in user's id - only used to keep each user's local fallback copy separate on shared PCs. */
  userId?: number;
  processName?:string;
  onRaiseClarification?: (taskIds: number[]) => void;
  deletableTaskIds?: Set<string>;
  onDeleteTask?: (id: string) => void;
}

const STATUS_CONFIG: Record<
  TaskStatusDisplay,
  { color: string; icon: React.ReactNode }
> = {
  Pending: {
    color: "text-yellow-600 bg-yellow-50 border-yellow-200",
    icon: <Clock className="w-3 h-3" />,
  },
  "In Progress": {
    color: "text-blue-600 bg-blue-50 border-blue-200",
    icon: <PauseCircle className="w-3 h-3" />,
  },
  Completed: {
    color: "text-green-600 bg-green-50 border-green-200",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  Cancelled: {
    color: "text-red-600 bg-red-50 border-red-200",
    icon: <XCircle className="w-3 h-3" />,
  },
  "On Hold": {
    color: "text-gray-600 bg-gray-50 border-gray-200",
    icon: <AlertCircle className="w-3 h-3" />,
  },
};

export const TaskTable: React.FC<TaskTableProps> = ({
  data,
  processFields = [],
  onUpdateTask,
  onSilentUpdateTask,
  onBulkUpdate,
  onDuplicateTask,
  addToast,
  onLoadMore,
  isFetchingNextPage,
  hasMore,
  onRefresh,
  isRefreshing,
  onAddTask,
  onSearchChange,
  totalCount,
  onExport,
  isExporting,
  processId,
  userId,
  processName,
  onRaiseClarification,
  deletableTaskIds,
  onDeleteTask
}) => {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [debouncedGlobalFilter, setDebouncedGlobalFilter] = useState("");

  const [filterSearch, setFilterSearch] = useState<Record<string, string>>({});
  const [filterSort, _setFilterSort] = useState<Record<string, 'asc' | 'desc'>>({});
  const [completedDateFilter, setCompletedDateFilter] = useState<
  'today' | '15days' | null
>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedGlobalFilter(globalFilter);
      setFocusedCell(null);
      onSearchChange?.(globalFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [globalFilter, onSearchChange]);
  // Starts with the default status filter so the grid doesn't flash every status while the saved view loads.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    () => fromFilterMap(DEFAULT_VIEW.filters),
  );
  const [columnSizing, setColumnSizing] = useState({});
  const [editingCell, setEditingCellState] = useState<{
    id: string;
    field: string;
  } | null>(null);
  const editingCellRef = useRef<{ id: string; field: string } | null>(null);
  const setEditingCell = useCallback(
    (cell: { id: string; field: string } | null) => {
      editingCellRef.current = cell;
      setEditingCellState(cell);
    },
    [],
  );

  const [optimisticallyCompleted, setOptimisticallyCompleted] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    setOptimisticallyCompleted((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(
        [...prev].filter((id) => {
          const t = data.find((d) => d.id === id);
          return t && t.status !== "Completed";
        }),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [data, columnFilters]);

  const inProgressPromotedRef = useRef<Set<string>>(new Set());

  // Rows the agent edited under the current filter. They stay visible even if the edit makes them
  // stop matching (Pending -> In Progress under "My Pending Tasks", or changing the filtered column).
  // Cleared as soon as the filters/search change, like Excel.
  const [stickyRowIds, setStickyRowIds] = useState<Set<string>>(() => new Set());
  const stickyRowIdsRef = useRef(stickyRowIds);
  stickyRowIdsRef.current = stickyRowIds;
  const keepRowVisible = useCallback((id: string) => {
    setStickyRowIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const handleUpdateTask = useCallback(
    (id: string, updates: Partial<Task>) => {
      if ("taskData" in updates || "dataChanged" in updates) keepRowVisible(id);
      onUpdateTask(id, updates);

      if ((updates as any).status === "Completed") {
        setOptimisticallyCompleted((prev) => new Set(prev).add(id));
      }

      const isDataEdit = "taskData" in updates || "dataChanged" in updates;
      const isStatusChange = "status" in updates;
      if (
        isDataEdit &&
        !isStatusChange &&
        !inProgressPromotedRef.current.has(id)
      ) {
        const current = data.find((t) => t.id === id);
        if (current && current.status === "Pending") {
          inProgressPromotedRef.current.add(id);
          onUpdateTask(id, {
            status: "In Progress" as TaskStatusDisplay,
            statusBackend: mapTaskStatusToBackend(
              "In Progress" as TaskStatusDisplay,
            ),
          });
        }
      }
    },
    [onUpdateTask, data, keepRowVisible],
  );

  const onSilentUpdate = useCallback(
    (id: string, updates: Partial<Task>) => {
      if ("taskData" in updates || "dataChanged" in updates) keepRowVisible(id);
      onSilentUpdateTask(id, updates);

      if ((updates as any).status === "Completed") {
        setOptimisticallyCompleted((prev) => new Set(prev).add(id));
      }

      const isDataEdit = "taskData" in updates || "dataChanged" in updates;
      const isStatusChange = "status" in updates;
      if (
        isDataEdit &&
        !isStatusChange &&
        !inProgressPromotedRef.current.has(id)
      ) {
        const current = data.find((t) => t.id === id);
        if (current && current.status === "Pending") {
          inProgressPromotedRef.current.add(id);
          onSilentUpdateTask(id, {
            status: "In Progress" as TaskStatusDisplay,
            statusBackend: mapTaskStatusToBackend(
              "In Progress" as TaskStatusDisplay,
            ),
          });
        }
      }
    },
    [onSilentUpdateTask, data, keepRowVisible],
  );

  const handleBulkUpdate = useCallback(
    (ids: string[], updates: Partial<Task>) => {
      onBulkUpdate(ids, updates);

      const becameCompleted = (updates as any).status === "Completed";
      if (becameCompleted) {
        setOptimisticallyCompleted((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.add(id));
          return next;
        });
      }

      setRowSelection({});

      if (onRefresh) {
        setTimeout(() => onRefresh(), 0);
      }
    },
    [onBulkUpdate, onRefresh],
  );

  const pendingValueRef = useRef<{
    taskId: string;
    fieldName: string;
    value: unknown;
  } | null>(null);
  const discardingRef = useRef<boolean>(false);
  // const [focusedCell, setFocusedCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{
    rowIndex: any;
    colId: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowId: string;
  } | null>(null);

  const [dragOrigin, setDragOrigin] = useState<{
    rowIndex: number;
    colId: string;
    value: unknown;
    fieldName: string;
  } | null>(null);
  const [dragEndRowIndex, setDragEndRowIndex] = useState<number | null>(null);
  const isDraggingRef = useRef(false);

  const [showFilters, setShowFilters] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [isSavingFilter, setIsSavingFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");
  const [selectedFilterId, setSelectedFilterId] = useState("all");
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(
    null,
  );
  const [validationErrors, setValidationErrors] = useState<
    Record<string, Set<string>>
  >({});

  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [exportStatus, setExportStatus] = useState<
    "" | "Pending" | "In Progress" | "Completed"
  >("");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");

  const [formulaBarValue, setFormulaBarValue] = useState("");
  const [formulaBarHeight, setFormulaBarHeight] = useState<number | null>(null);
  const formulaBarRef = useRef<HTMLTextAreaElement>(null);
  const formulaCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // True ONLY while the textarea itself holds focus.
  const formulaBarFocusedRef = useRef(false);

  const processKey = String(processId ?? "default");
  const COLUMN_PREFS_KEY = `taskTable.columnPrefs_${processKey}`;
  const SAVED_FILTERS_KEY = `taskTable.savedFilters_${processKey}`;

  const isColumnEditable = useCallback((column: any) => {
    const colId = column.id || column.accessorKey;
    if (colId?.startsWith("field_")) {
      return true;
    }
    return false;
  }, []);

  const handleDuplicateRow = useCallback(
    (rowId: string, direction: "above" | "below") => {
      const sourceTask = data.find((d) => d.id === rowId);
      if (!sourceTask) return;

      if (onDuplicateTask) {
        onDuplicateTask(sourceTask, direction);
        // addToast(`Row duplicated ${direction}.`, 'success');
      } else {
        addToast("Duplicate row is not connected - pass", "error");
      }
      setContextMenu(null);
    },
    [data, onDuplicateTask, addToast],
  );

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);

  // Keep focusedCell in a ref so handleLiveEdit stays referentially stable —
  // otherwise dynamicColumns would rebuild on every focus change.
  const focusedCellRef = useRef<{ rowId: string; colId: string } | null>(null);
  focusedCellRef.current = focusedCell;

  // Instant cell→fx mirror: in-cell inputs call this on every keystroke so the
  // formula bar reflects typing immediately. Defined ABOVE dynamicColumns
  // (which references it); uses refs to read focusedCell so its own identity
  // never changes and the columns memo doesn't rebuild on focus changes.
  const handleLiveEdit = useCallback(
    (taskId: string, fieldName: string, value: unknown) => {
      if (formulaBarFocusedRef.current) return;
      const fc = focusedCellRef.current;
      if (!fc) return;
      if (fc.rowId !== taskId) return;
      if (fc.colId !== `field_${fieldName}`) return;
      const display = Array.isArray(value)
        ? value.join(", ")
        : value == null
          ? ""
          : String(value);
      setFormulaBarValue(display);
    },
    [],
  );

//   const [completedFilter, setCompletedFilter] = useState<
//   'today' | '15days' | null
// >(null);
// const filteredData = useMemo(() => {
//   let result = data;

//   if (completedFilter === 'today') {
//     const today = new Date();

//     result = result.filter(t => {
//       if (t.status !== 'Completed' || !t.completedDate) {
//         return false;
//       }

//       const completed = new Date(t.completedDate);

//       return (
//         completed.getDate() === today.getDate() &&
//         completed.getMonth() === today.getMonth() &&
//         completed.getFullYear() === today.getFullYear()
//       );
//     });
//   }

//   if (completedFilter === '15days') {
//     result = result.filter(
//       t => t.status === 'Completed'
//     );
//   }

//   return result;
// }, [data, completedFilter]);

const completedTodayCount = useMemo(() => {
  const today = new Date();

  return data.filter(t => {
    if (t.status !== 'Completed' || !t.completedDate) return false;

    const completed = new Date(t.completedDate);

    return (
      completed.getDate() === today.getDate() &&
      completed.getMonth() === today.getMonth() &&
      completed.getFullYear() === today.getFullYear()
    );
  }).length;
}, [data]);

const completedLast15DaysCount = useMemo(() => {
  return data.filter(t => t.status === 'Completed').length;
}, [data]);

  const dynamicColumns = useMemo(() => {
    return generateDynamicColumns(
      processFields,
      editingCellRef,
      setEditingCell,
      handleUpdateTask,
      validationErrors,
      addToast,
      pendingValueRef,
      discardingRef,
      handleLiveEdit,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processFields, handleUpdateTask, validationErrors, addToast]);

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <div className="px-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
              checked={table.getIsAllPageRowsSelected()}
              ref={(el) => {
                if (el) el.indeterminate = table.getIsSomePageRowsSelected();
              }}
              onChange={table.getToggleAllPageRowsSelectedHandler()}
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="px-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect()}
              onChange={row.getToggleSelectedHandler()}
            />
          </div>
        ),
        size: 40,
      },
      {
        id: "priority",
        accessorKey: "priority",
        header: "Priority",
        filterFn: stringFilterFn,
        cell: ({ row, getValue }) => {
          const priority = getValue() as TaskPriority;
          const colors = {
            Low: "text-gray-500 bg-gray-50 border-gray-200",
            Medium: "text-blue-500 bg-blue-50 border-blue-200",
            High: "text-orange-500 bg-orange-50 border-orange-200",
            Urgent: "text-red-600 bg-red-50 border-red-200",
          };
          return (
            <div className="w-full h-full flex items-center">
              <span
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-bold uppercase border",
                  colors[priority],
                )}
              >
                {priority}
              </span>
            </div>
          );
        },
        size: 90,
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        filterFn: stringFilterFn,
        cell: ({ row, getValue }) => {
          const status = getValue() as TaskStatusDisplay;
          const config = STATUS_CONFIG[status];
          return (
            <div className="w-full h-full flex items-center">
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-opacity",
                  config.color,
                )}
              >
                {config.icon}
                {status}
              </div>
            </div>
          );
        },
        size: 130,
      },
      ...dynamicColumns,
      {
        id: "actions",
        header: "Action",
        enableSorting: false,
        enableResizing: false,
        size: 165,
        cell: ({ row, table }) => {
          const handleSubmit = (e: React.MouseEvent) => {
            e.stopPropagation();
            const selectedRows = table.getSelectedRowModel().rows;
            if (
              selectedRows.length > 0 &&
              selectedRows.some((r) => r.id === row.id)
            ) {
              const ids = selectedRows.map((r) => r.original.id);
              handleBulkUpdate(ids, row.original);
            } else {
              handleBulkUpdate([row.original.id], row.original);
            }
          };

          const isPartOfSelection = table
            .getSelectedRowModel()
            .rows.some((r) => r.id === row.id);
          const selectionCount = table.getSelectedRowModel().rows.length;

          return (
            <div className="flex items-center justify-center gap-2 w-full">
              <button
                type="button"
                onClick={() => {
                  const currentRow = row;
                  const taskData = currentRow.original.taskData || {};
                  const taskId = currentRow.original.id;

                  if (currentRow.original.status === "Completed") {
                    addToast("Task is already marked as completed.", "info");
                    return;
                  }

                  const coreRequiredFieldNames = [
                    "statuscode",
                    "invoice",
                    "followuptype",
                  ];
                  const requiredFieldObjects = processFields
                    .filter(
                      (field) =>
                        !field.isDeleted &&
                        (field.isRequired ||
                          coreRequiredFieldNames.includes(
                            field.fieldName.toLowerCase(),
                          )),
                    )
                    .map((field) => field.fieldName);

                  const missingFields = requiredFieldObjects.filter(
                    (fieldName) => {
                      const value = taskData[fieldName];
                      if (value == null) return true;
                      if (typeof value === "string") return value.trim() === "";
                      if (Array.isArray(value)) return value.length === 0;
                      return false;
                    },
                  );

                  if (missingFields.length > 0) {
                    setValidationErrors({ [taskId]: new Set(missingFields) });
                    const missingFieldsSummary = missingFields.join(", ");
                    addToast(
                      `Cannot mark complete. Missing required fields: ${missingFieldsSummary}`,
                      "error",
                    );
                    return;
                  }

                  setValidationErrors({});
                  handleBulkUpdate([taskId], {
                    status: "Completed",
                    statusBackend: "Completed",
                  });
                  addToast(`Successfully marked as complete.`, "success");
                }}
                tabIndex={-1}
                className="px-3 py-1 ring-1 ring-lime-600 text-lime-800 rounded-md hover:bg-lime-700 text-xs cursor-pointer hover:text-white transition-colors whitespace-nowrap"
              >
                Submit
              </button>
              <button
  type="button"
  onClick={(e) => {
    e.stopPropagation();

    handleBulkUpdate(
      [row.original.id],
      {
        status: 'On Hold',
        statusBackend: 'OnHold'
      }
    );

    addToast('Task moved to On Hold', 'success');
  }}
  className="flex items-center gap-1 px-3 py-1 ring-1 ring-amber-600 text-amber-800 rounded-md hover:bg-amber-700 text-xs cursor-pointer hover:text-white transition-colors whitespace-nowrap"
>
  <PauseCircle className="w-3 h-3" />
  Hold
</button>
            </div>
          );
        },
      },
    ],
    [
      dynamicColumns,
      handleUpdateTask,
      handleBulkUpdate,
      processFields,
      addToast,
    ],
  );

  const prefsLoadedKeyRef = useRef<string | null>(null);

  const enforceColumnOrder = useCallback((order: string[]): string[] => {
    const withoutPinned = order.filter(
      (id) => id !== "select" && id !== "actions",
    );
    const result: string[] = [];
    if (order.includes("select")) result.push("select");
    result.push(...withoutPinned);
    if (order.includes("actions")) result.push("actions");
    return result;
  }, []);

  useEffect(() => {
    if (prefsLoadedKeyRef.current === COLUMN_PREFS_KEY) return;
    if (columns.length === 0) return;
    prefsLoadedKeyRef.current = COLUMN_PREFS_KEY;

    const naturalOrder = columns.map((c) => c.id || (c as any).accessorKey);
    const validIds = new Set(naturalOrder);

    try {
      const raw = localStorage.getItem(COLUMN_PREFS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          order?: string[];
          visibility?: VisibilityState;
        };

        if (Array.isArray(saved.order)) {
          const savedValid = saved.order.filter((id) => validIds.has(id));
          const missing = naturalOrder.filter((id) => !savedValid.includes(id));
          setColumnOrder(enforceColumnOrder([...savedValid, ...missing]));
        } else {
          setColumnOrder(enforceColumnOrder(naturalOrder));
        }

        if (saved.visibility && typeof saved.visibility === "object") {
          const filtered = Object.fromEntries(
            Object.entries(saved.visibility).filter(([id]) => validIds.has(id)),
          );
          setColumnVisibility(filtered);
        }
        return;
      }
    } catch {
      /* corrupt prefs — ignore and use defaults */
    }

    setColumnOrder(enforceColumnOrder(naturalOrder));
  }, [columns, enforceColumnOrder, COLUMN_PREFS_KEY]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prefsLoadedKeyRef.current !== COLUMN_PREFS_KEY) return;
    if (columnOrder.length === 0) return;
    try {
      localStorage.setItem(
        COLUMN_PREFS_KEY,
        JSON.stringify({ order: columnOrder, visibility: columnVisibility }),
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [columnOrder, columnVisibility, COLUMN_PREFS_KEY]);

  // ---------------------------------------------------------------------------
  // View persistence: search, filters, sort, columns and the quick-filter survive
  // sign-out / refresh, and "My Filters" are stored per user on the server.
  // ---------------------------------------------------------------------------
  const persistProcessId = processId != null && processId !== "" ? Number(processId) : undefined;

  const view = useMemo<TaskView>(
    () => ({
      search: debouncedGlobalFilter,
      filters: toFilterMap(columnFilters),
      sorting,
      columnVisibility,
      columnOrder,
      quickFilter: selectedFilterId,
      completedDateFilter,
      v: 1,
    }),
    [debouncedGlobalFilter, columnFilters, sorting, columnVisibility, columnOrder, selectedFilterId, completedDateFilter],
  );

  // Read through a ref so applyView stays stable while columns rebuild.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const applyView = useCallback(
    (v: TaskView) => {
      const search = v.search ?? "";
      setGlobalFilter(search);
      setDebouncedGlobalFilter(search);
      setColumnFilters(fromFilterMap(v.filters));
      setSorting(Array.isArray(v.sorting) ? (v.sorting as SortingState) : []);
      setSelectedFilterId(v.quickFilter ?? "all");
      setCompletedDateFilter(v.completedDateFilter ?? null);
      setFocusedCell(null);

      // Columns: only when the view has them, otherwise keep the existing local column prefs.
      if (v.columnVisibility && Object.keys(v.columnVisibility).length > 0) {
        setColumnVisibility(v.columnVisibility);
      }
      if (Array.isArray(v.columnOrder) && v.columnOrder.length > 0) {
        // Don't drop ids that aren't loaded yet (process fields arrive later); just append new columns.
        const natural = columnsRef.current.map((c) => c.id || (c as any).accessorKey);
        const merged = [...v.columnOrder, ...natural.filter((id) => !v.columnOrder!.includes(id))];
        setColumnOrder(enforceColumnOrder(merged));
      }
    },
    [enforceColumnOrder],
  );

  const { loaded, saved, saveAs, applySaved, deleteSaved } = useTaskViewPersistence(
    persistProcessId,
    userId,
    view,
    applyView,
    DEFAULT_VIEW,
  );

  const handleSaveFilter = useCallback(async () => {
    const name = newFilterName.trim();
    if (!name) return;

    const exists = saved.some((s) => s.name.toLowerCase() === name.toLowerCase());
    if (exists && !window.confirm(`A filter named "${name}" already exists. Replace it?`)) return;

    try {
      const created = await saveAs(name, exists);
      if (created) setSelectedFilterId(`saved_${created.id}`);
      setNewFilterName("");
      setIsSavingFilter(false);
      addToast(`Filter "${name}" saved.`, "success");
    } catch {
      addToast("Could not save the filter. Please try again.", "error");
    }
  }, [newFilterName, saved, saveAs, addToast]);

  // One-time move of filters saved by the old localStorage version, so agents don't lose them.
  const migratedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || migratedKeyRef.current === SAVED_FILTERS_KEY) return;
    migratedKeyRef.current = SAVED_FILTERS_KEY;

    let old: { name?: string; filters?: ColumnFiltersState }[] = [];
    try {
      old = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || "[]");
    } catch {
      old = [];
    }
    if (!Array.isArray(old) || old.length === 0) return;

    (async () => {
      for (const f of old) {
        const name = f?.name?.trim();
        if (!name || saved.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
        try {
          await saveAs(name, false, {
            ...DEFAULT_VIEW,
            filters: toFilterMap(Array.isArray(f.filters) ? f.filters : []),
          });
        } catch {
          /* skip this one */
        }
      }
      try {
        localStorage.removeItem(SAVED_FILTERS_KEY);
      } catch {
        /* ignore */
      }
    })();
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredData = useMemo(() => {
  let result = data.filter(
    t => !optimisticallyCompleted.has(t.id)
  );

  if (completedDateFilter === 'today') {
    const today = new Date();

    result = result.filter(t => {
      if (t.status !== 'Completed' || !t.completedDate) {
        return false;
      }

      const completed = new Date(t.completedDate);

      return (
        completed.getDate() === today.getDate() &&
        completed.getMonth() === today.getMonth() &&
        completed.getFullYear() === today.getFullYear()
      );
    });
  }

  if (completedDateFilter === '15days') {
    result = result.filter(
      t => t.status === 'Completed'
    );
  }

  return result;
}, [data, optimisticallyCompleted, completedDateFilter]);

  // A new filter/search/quick-filter/process starts clean: edited rows only stay while the filter is unchanged.
  useEffect(() => {
    setStickyRowIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [columnFilters, debouncedGlobalFilter, completedDateFilter, processId]);

  // Default TanStack filtering, plus the sticky rows added back in their original position.
  const filteredRowModel = useMemo(() => {
    const base = getFilteredRowModel<Task>();
    return (t: Table<Task>) => {
      const compute = base(t);
      let lastBase: RowModel<Task> | null = null;
      let lastSticky: Set<string> | null = null;
      let lastResult: RowModel<Task> | null = null;

      return () => {
        const filtered = compute();
        const sticky = stickyRowIdsRef.current;
        if (lastResult && filtered === lastBase && sticky === lastSticky) return lastResult;
        lastBase = filtered;
        lastSticky = sticky;

        if (sticky.size === 0) return (lastResult = filtered);
        const present = new Set(filtered.rows.map((r) => r.id));
        if ([...sticky].every((id) => present.has(id))) return (lastResult = filtered);

        const rows = t
          .getPreFilteredRowModel()
          .rows.filter((r) => present.has(r.id) || sticky.has(r.id));
        const rowsById: Record<string, Row<Task>> = {};
        rows.forEach((r) => (rowsById[r.id] = r));
        return (lastResult = { rows, flatRows: rows, rowsById });
      };
    };
  }, []);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      rowSelection,
      sorting,
      globalFilter: debouncedGlobalFilter,
      columnFilters,
      columnSizing,
      columnVisibility,
      columnOrder,
    },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    columnResizeMode: "onChange",
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onGlobalFilterChange: setDebouncedGlobalFilter,
    onColumnFiltersChange: (updater) => {
      setFocusedCell(null);
      setColumnFilters(updater as ColumnFiltersState);
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    enableFilters: true,
    enableGlobalFilter: true,
    globalFilterFn: globalDeepSearchFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: filteredRowModel,
    getSortedRowModel: getSortedRowModel(),
  });

  // Values offered in each filter dropdown, Excel-style: a column's list only contains values from
  // rows that pass the OTHER filters + search (its own filter is ignored, so you can still change it).
  // Uses the table's real filter functions, so the counts always match what the grid shows.
  const preFilteredRows = table.getPreFilteredRowModel().rows;
  const categoricalCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};

    const columnsById = new Map(table.getAllLeafColumns().map((c) => [c.id, c]));
    const isActive = (v: unknown) =>
      v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
    const active = columnFilters.filter(
      (f) => isActive(f.value) && columnsById.has(f.id),
    );
    const noMeta = () => {};

    const passes = (row: Row<Task>, skipId: string) => {
      if (debouncedGlobalFilter && !globalDeepSearchFn(row, "", debouncedGlobalFilter)) return false;
      for (const f of active) {
        if (f.id === skipId) continue;
        const fn = columnsById.get(f.id)!.getFilterFn();
        if (fn && !fn(row, f.id, f.value, noMeta)) return false;
      }
      return true;
    };

    const displayValue = (task: Task, key: string) => {
      if (key.startsWith("field_")) {
        const raw = task.taskData?.[key.slice(6)];
        return String((raw ?? "") || "Empty");
      }
      return String((task as any)[key] || "Unassigned");
    };

    // Only the dropdowns that are actually open in the filter panel need counts.
    for (const f of columnFilters) {
      const key = f.id;
      const bucket: Record<string, number> = {};
      for (const row of preFilteredRows) {
        if (!passes(row, key)) continue;
        const val = displayValue(row.original, key);
        bucket[val] = (bucket[val] || 0) + 1;
      }
      // Keep this column's ticked values listed (count 0) so they can still be unticked.
      if (Array.isArray(f.value)) {
        for (const v of f.value) {
          const k = String(v);
          if (!(k in bucket)) bucket[k] = 0;
        }
      }
      counts[key] = bucket;
    }

    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preFilteredRows, columnFilters, debouncedGlobalFilter, columns]);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { rows } = table.getRowModel();
  const rowsRef = useRef<typeof rows>([]);
  rowsRef.current = rows;

  useEffect(() => {
    const handleMouseUp = () => {
      if (
        !isDraggingRef.current ||
        dragOrigin === null ||
        dragEndRowIndex === null
      ) {
        isDraggingRef.current = false;
        setDragOrigin(null);
        setDragEndRowIndex(null);
        return;
      }
      isDraggingRef.current = false;
      const currentRows = rowsRef.current;

      const startIdx = Math.min(dragOrigin.rowIndex, dragEndRowIndex);
      const endIdx = Math.max(dragOrigin.rowIndex, dragEndRowIndex);

      for (let i = startIdx; i <= endIdx; i++) {
        if (i === dragOrigin.rowIndex) continue;
        const targetRow = currentRows[i];
        if (!targetRow) continue;
        const currentTaskData = targetRow.original.taskData || {};
        handleUpdateTask(targetRow.original.id, {
          taskData: {
            ...currentTaskData,
            [dragOrigin.fieldName]: dragOrigin.value,
          },
          dataChanged: { [dragOrigin.fieldName]: dragOrigin.value },
        });
      }

      setDragOrigin(null);
      setDragEndRowIndex(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [dragOrigin, dragEndRowIndex, handleUpdateTask]);
  const selectedRows = table.getSelectedRowModel().rows as Row<Task>[];
  const hasSelection = selectedRows.length > 0;

  const focusedFieldInfo = useMemo(() => {
    if (!focusedCell) return null;
    const { rowIndex, colId } = focusedCell;
    if (!colId?.startsWith("field_")) return null;
    const fieldName = colId.replace("field_", "");
    const field = processFields.find(
      (f) => f.fieldName === fieldName && !f.isDeleted,
    );
    if (!field) return null;
    const row = rows.find((r) => r.id === rowIndex);
    if (!row) return null;
    const isEditable = !field.isReadOnly;
    return { row, field, fieldName, isEditable };
  }, [focusedCell, processFields, rows]);

  const focusedCellDisplayValue = useMemo(() => {
    if (!focusedCell) return "";
    if (focusedFieldInfo) {
      const raw =
        focusedFieldInfo.row.original.taskData?.[focusedFieldInfo.fieldName];
      return Array.isArray(raw)
        ? raw.join(", ")
        : raw == null
          ? ""
          : String(raw);
    }
    const row = rows.find((r) => r.id === focusedCell.rowIndex);
    if (row) {
      const cell = row
        .getVisibleCells()
        .find((c) => c.column.id === focusedCell.colId);
      const v = cell?.getValue();
      return v == null ? "" : String(v);
    }
    return "";
  }, [focusedCell, focusedFieldInfo, rows]);

  useEffect(() => {
    if (formulaBarFocusedRef.current) return;
    setFormulaBarValue(focusedCellDisplayValue);
  }, [focusedCellDisplayValue, focusedCell]);

  const commitFormulaBar = useCallback(
    (rawValue: string) => {
      if (!focusedFieldInfo || !focusedFieldInfo.isEditable) return;
      const { row, field, fieldName } = focusedFieldInfo;
      const currentTaskData = row.original.taskData || {};

      const rawType = String((field as any).fieldType ?? "").toLowerCase();
      const isNumeric =
        rawType === "2" || rawType === "number" || rawType === "numeric";

      let nextValue: unknown = rawValue;
      if (isNumeric) {
        nextValue = rawValue.trim() !== "" ? parseFloat(rawValue) : null;
        if (typeof nextValue === "number" && isNaN(nextValue)) return;
      }

      const existing = currentTaskData[fieldName];
      const existingStr = Array.isArray(existing)
        ? existing.join(", ")
        : existing == null
          ? ""
          : String(existing);
      if (existingStr === String(nextValue ?? "")) return;

      onSilentUpdate(row.original.id, {
        taskData: { ...currentTaskData, [fieldName]: nextValue },
        dataChanged: { [fieldName]: nextValue },
      });
    },
    [focusedFieldInfo, onSilentUpdate],
  );

  const scheduleCommitFormulaBar = useCallback(
    (rawValue: string) => {
      if (formulaCommitTimerRef.current)
        clearTimeout(formulaCommitTimerRef.current);
      formulaCommitTimerRef.current = setTimeout(() => {
        commitFormulaBar(rawValue);
        formulaCommitTimerRef.current = null;
      }, 400);
    },
    [commitFormulaBar],
  );

  useEffect(() => {
    if (formulaBarHeight !== null) return;
    const el = formulaBarRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 320);
    el.style.height = `30px`;
    // el.style.height = `${Math.max(next, 38)}px`;
  }, [formulaBarValue, formulaBarHeight, focusedCell]);

  useEffect(() => {
    return () => {
      if (formulaCommitTimerRef.current)
        clearTimeout(formulaCommitTimerRef.current);
    };
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  useEffect(() => {
    if (focusedCell) {
      const visibleCols = rows[0]?.getVisibleCells().map((c) => c.column) ?? [];
      const column =
        visibleCols.find((c) => c.id === focusedCell.colId) ??
        columns.find((c) => (c as any).id === focusedCell.colId);
      const row = rows.find((r) => r.id === focusedCell.rowIndex);

      if (row && column && isColumnEditable(column)) {
        const field = (column as any).accessorKey || column.id;
        if (
          editingCell?.id !== row.original.id ||
          editingCell?.field !== field
        ) {
          setEditingCell({ id: row.original.id, field: String(field) });
        }
      } else {
        if (editingCell !== null) {
          setEditingCell(null);
        }
      }
    } else {
      if (editingCell !== null) {
        setEditingCell(null);
      }
    }
  }, [focusedCell, columns, rows, isColumnEditable]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      focusedCell &&
      editingCell &&
      editingCell.id === focusedCell.rowIndex &&
      editingCell.field === focusedCell.colId
    ) {
      const timer = setTimeout(() => {
        const cellElement = document.querySelector(
          `[data-cell-id="${editingCell.id}-${editingCell.field}"]`,
        ) as HTMLElement;
        if (!cellElement) return;
        const tag = cellElement.tagName;
        const focusable =
          tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA"
            ? cellElement
            : (cellElement.querySelector(
                "input, select, textarea",
              ) as HTMLElement);
        if (focusable) {
          if (document.activeElement !== focusable) {
            focusable.focus();
          }
          if (focusable.tagName === "SELECT") {
            try {
              (focusable as HTMLSelectElement).showPicker();
            } catch {
              /* unsupported */
            }
          }
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [focusedCell, editingCell]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement;
      const isCheckbox =
        e.target instanceof HTMLInputElement && e.target.type === "checkbox";

      if (isInput && !isCheckbox && e.key !== "Escape" && e.key !== "Tab")
        return;

      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "c" &&
        hasSelection
      ) {
        e.preventDefault();

        const rowsToUpdate = selectedRows.filter(
          (row) => row.original.status !== "Completed",
        );

        if (rowsToUpdate.length === 0) {
          addToast("All selected tasks are already completed.", "info");
          return;
        }

        const ids = rowsToUpdate.map((r) => r.original.id);

        handleBulkUpdate(ids, {
          status: "Completed",
          statusBackend: "Completed",
        });

        addToast(`Marked ${ids.length} task(s) as completed.`, "success");
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "b" && hasSelection) {
        e.preventDefault();
        const status = prompt(
          "Enter status (Pending, In Progress, Completed, Cancelled, On Hold):",
        );
        if (status && Object.keys(STATUS_CONFIG).includes(status)) {
          const ids = selectedRows.map((r) => r.original.id);
          const statusDisplay = status as TaskStatusDisplay;
          handleBulkUpdate(ids, {
            status: statusDisplay,
            statusBackend: mapTaskStatusToBackend(statusDisplay),
          });
        }
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "d" &&
        focusedCell
      ) {
        e.preventDefault();
        const r = rows.find((r) => r.id === focusedCell.rowIndex);
        if (r)
          handleDuplicateRow(r.original.id, e.shiftKey ? "above" : "below");
        return;
      }

      if (!focusedCell) {
        if (
          e.key === "j" ||
          e.key === "ArrowDown" ||
          e.key === "k" ||
          e.key === "ArrowUp"
        ) {
          if (rows.length > 0) {
            const firstVisibleCols = rows[0]
              .getVisibleCells()
              .map((c) => c.column);
            setFocusedCell({
              rowIndex: rows[0].id,
              colId: firstVisibleCols[0]?.id ?? "",
            });
          }
        }
        return;
      }

      const { rowIndex, colId } = focusedCell;
      const rowIndexNum = rows.findIndex((r) => r.id === rowIndex);
      const safeRowIndex = rowIndexNum === -1 ? 0 : rowIndexNum;
      const rowCount = rows.length;
      const visibleCols =
        rows[safeRowIndex]?.getVisibleCells().map((c) => c.column) ?? [];
      const colCount = visibleCols.length;
      const colIndex = visibleCols.findIndex((c) => c.id === colId);
      const safeColIndex = colIndex === -1 ? 0 : colIndex;

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          let nextRowIndex = safeRowIndex;
          let nextVisColIndex = safeColIndex;

          if (e.shiftKey) {
            if (safeColIndex > 0) {
              nextVisColIndex = safeColIndex - 1;
            } else if (safeRowIndex > 0) {
              nextRowIndex = safeRowIndex - 1;
              nextVisColIndex = colCount - 1;
            } else {
              nextRowIndex = rowCount - 1;
              nextVisColIndex = colCount - 1;
            }
          } else {
            if (safeColIndex < colCount - 1) {
              nextVisColIndex = safeColIndex + 1;
            } else if (safeRowIndex < rowCount - 1) {
              nextRowIndex = safeRowIndex + 1;
              nextVisColIndex = 0;
            } else {
              nextRowIndex = 0;
              nextVisColIndex = 0;
            }
          }

          discardingRef.current = false;
          if (pendingValueRef.current) {
            const {
              taskId,
              fieldName,
              value: pendingVal,
            } = pendingValueRef.current;
            const currentRow = rows.find((r) => r.original.id === taskId);
            if (currentRow) {
              const currentTaskData = currentRow.original.taskData || {};
              const existingVal = currentTaskData[fieldName];
              const isNumericField =
                typeof existingVal === "number" || existingVal === null;
              if (isNumericField) {
                const raw = String(pendingVal ?? "");
                const numValue = raw.trim() !== "" ? parseFloat(raw) : null;
                if (!isNaN(numValue as number) || numValue === null) {
                  handleUpdateTask(taskId, {
                    taskData: { ...currentTaskData, [fieldName]: numValue },
                    dataChanged: { [fieldName]: numValue },
                  });
                }
              } else {
                const strVal = String(pendingVal ?? "");
                if (strVal !== String(existingVal ?? "")) {
                  handleUpdateTask(taskId, {
                    taskData: { ...currentTaskData, [fieldName]: strVal },
                    dataChanged: { [fieldName]: strVal },
                  });
                }
              }
            }
            pendingValueRef.current = null;
          }

          const nextColId = visibleCols[nextVisColIndex]?.id ?? colId;
          setFocusedCell({ rowIndex: rows[nextRowIndex].id, colId: nextColId });
          if (nextRowIndex !== safeRowIndex) {
            rowVirtualizer.scrollToIndex(nextRowIndex, { align: "auto" });
          }
          if (
            nextVisColIndex !== safeColIndex ||
            nextRowIndex !== safeRowIndex
          ) {
            requestAnimationFrame(() => {
              setTimeout(() => {
                const container = tableContainerRef.current;
                if (!container) return;

                const focused = container.querySelector(
                  `[data-row="${nextRowIndex}"][data-col="${nextColId}"]`,
                ) as HTMLElement | null;
                // if (!focused || !tableContainerRef.current) return;

                if (focused) {
                  const containerRect = container.getBoundingClientRect();
                  const cellRect = focused.getBoundingClientRect();

                  const overflowRight = cellRect.right - containerRect.right;
                  const overflowLeft = containerRect.left - cellRect.left;

                  if (overflowRight > 0) {
                    container.scrollLeft += overflowRight + 16;
                  } else if (overflowLeft > 0) {
                    container.scrollLeft -= overflowLeft + 16;
                  }

                  const select = focused.querySelector(
                    "select",
                  ) as HTMLSelectElement | null;
                  if (select) {
                    select.focus();
                    try {
                      select.showPicker();
                    } catch {}
                  } else {
                    focused.focus();
                  }
                }
              }, 50);
            });
          }
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          const nextUp = Math.max(0, safeRowIndex - 1);
          setFocusedCell({ rowIndex: rows[nextUp].id, colId });
          rowVirtualizer.scrollToIndex(nextUp, { align: "auto" });
          break;
        case "ArrowDown":
        case "j":
          e.preventDefault();
          const nextDown = Math.min(rowCount - 1, safeRowIndex + 1);
          setFocusedCell({ rowIndex: rows[nextDown].id, colId });
          rowVirtualizer.scrollToIndex(nextDown, { align: "auto" });
          break;
        case "ArrowLeft":
        case "h":
          e.preventDefault();
          setFocusedCell({
            rowIndex,
            colId: visibleCols[Math.max(0, safeColIndex - 1)]?.id ?? colId,
          });
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          setFocusedCell({
            rowIndex,
            colId:
              visibleCols[Math.min(colCount - 1, safeColIndex + 1)]?.id ??
              colId,
          });
          break;
        case "x":
        case " ":
          if (
            document.activeElement instanceof HTMLInputElement &&
            document.activeElement.type === "checkbox"
          )
            break;
          e.preventDefault();
          rows[safeRowIndex].toggleSelected();
          break;
        case "Enter":
        case "e":
          e.preventDefault();
          const colForEnter = visibleCols[safeColIndex];
          const rowForEnter = rows[safeRowIndex];
          if (colForEnter && isColumnEditable(colForEnter)) {
            const field = (colForEnter as any).accessorKey || colForEnter.id;
            setEditingCell({
              id: rowForEnter.original.id,
              field: String(field),
            });
          }
          break;
        case "Escape":
          e.preventDefault();
          if (editingCell) {
            discardingRef.current = true;
            pendingValueRef.current = null;
            setEditingCell(null);
          } else {
            setFocusedCell(null);
            setRowSelection({});
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    hasSelection,
    selectedRows,
    handleBulkUpdate,
    handleUpdateTask,
    focusedCell,
    rows,
    columns,
    editingCell,
    isColumnEditable,
    rowVirtualizer,
    handleDuplicateRow,
  ]);

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {/* <div className="flex items-center px-4 py-2.5 bg-white border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900 truncate">{processName || 'Process'}</h2>
      </div> */}
      {/* Excel-style formula bar */}
      <div className="relative flex items-stretch border-b border-gray-200 bg-gray-50/70">
        <div className="flex items-center px-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-r border-gray-200 select-none min-w-[64px] max-w-[120px] justify-center text-center">
          <span className="truncate">
            {focusedCell && focusedFieldInfo
              ? focusedFieldInfo.fieldName
              : "fx"}
          </span>
        </div>
        <textarea
          ref={formulaBarRef}
          value={formulaBarValue}
          readOnly={!focusedFieldInfo?.isEditable}
          placeholder={
            focusedCell
              ? focusedFieldInfo?.isEditable
                ? "Edit selected cell…"
                : "Selected cell is read-only"
              : "Select a cell to view or edit. Press Enter to save your changes."
          }
          onFocus={() => {
            formulaBarFocusedRef.current = true;
          }}
          onChange={(e) => {
            setFormulaBarValue(e.target.value);
          }}
          onBlur={() => {
            formulaBarFocusedRef.current = false;
            if (formulaCommitTimerRef.current) {
              clearTimeout(formulaCommitTimerRef.current);
              formulaCommitTimerRef.current = null;
            }
            if (focusedFieldInfo?.isEditable) commitFormulaBar(formulaBarValue);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (formulaCommitTimerRef.current) {
                clearTimeout(formulaCommitTimerRef.current);
                formulaCommitTimerRef.current = null;
              }
              if (focusedFieldInfo?.isEditable)
                commitFormulaBar(formulaBarValue);
              formulaBarFocusedRef.current = false;
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              if (formulaCommitTimerRef.current) {
                clearTimeout(formulaCommitTimerRef.current);
                formulaCommitTimerRef.current = null;
              }
              setFormulaBarValue(focusedCellDisplayValue);
              formulaBarFocusedRef.current = false;
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className={cn(
            "flex-1 resize-none px-3 py-2 text-sm bg-white outline-none leading-snug overflow-y-auto",
            !focusedFieldInfo?.isEditable &&
              "bg-gray-50 text-gray-500 cursor-default",
          )}
          style={{
            minHeight: "35px",
            height:
              formulaBarHeight !== null ? `${formulaBarHeight}px` : undefined,
            maxHeight: formulaBarHeight !== null ? undefined : "320px",
          }}
        />

        <div
          title="Drag to resize"
          onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = formulaBarRef.current?.offsetHeight ?? 38;
            const onMove = (moveEvt: MouseEvent) => {
              const delta = moveEvt.clientY - startY;
              const next = Math.max(38, Math.min(startHeight + delta, 600));
              setFormulaBarHeight(next);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          onDoubleClick={() => setFormulaBarHeight(null)}
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-transparent hover:bg-brand-primary/30 transition-colors flex items-center justify-center group/resize"
        >
          <div className="w-8 h-0.5 bg-gray-300 group-hover/resize:bg-brand-primary rounded-full" />
        </div>
      </div>

      {/* Table Header / Toolbar */}
      <div className="flex flex-col border-bottom border-gray-200 bg-gray-50/50">
        <div className="flex items-center justify-between p-3 gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search tasks, refs, comments... (Ctrl+F)"
                className="w-full pl-9 pr-10 py-1.5 text-sm bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
              {globalFilter && (
                <button
                  onClick={() => {
                    setGlobalFilter("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setShowFilters(!showFilters);
                  setShowColumnSettings(false);
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-md transition-all",
                  showFilters || columnFilters.length > 0
                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                )}
              >
                <FilterIcon className="w-4 h-4" />
                Filters
                {columnFilters.length > 0 && (
                  <span className="flex items-center justify-center w-5 h-5 text-[10px] bg-brand-primary text-white rounded-full ml-1">
                    {columnFilters.length}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1">
                <select
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors outline-none"
                  value={selectedFilterId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedFilterId(val);
                    setCompletedDateFilter(null);
                    if (val === 'pending') {
                      table.getColumn('status')?.setFilterValue(['Pending']);
                      table.getColumn('priority')?.setFilterValue(undefined);
                    } else if (val === 'inprogress') {
                      table.getColumn('status')?.setFilterValue(['In Progress']);
                      table.getColumn('priority')?.setFilterValue(undefined);
                    } else if (val === 'completedtoday') {
                      setCompletedDateFilter('today');
                      table.getColumn('status')?.setFilterValue(['Completed']);
                    }
                    else if (val === 'completed15days') {
                      setCompletedDateFilter('15days');
                      table.getColumn('status')?.setFilterValue(['Completed']);
                    }
                    else if (val === 'completed') {
                      table.getColumn('status')?.setFilterValue(['Completed']);
                      table.getColumn('priority')?.setFilterValue(undefined);
                    } else if (val === 'urgent') {
                      table.getColumn('priority')?.setFilterValue(['Urgent']);
                      table.getColumn('status')?.setFilterValue(undefined);
                    } else if (val === 'cancelled') {
                      table.getColumn('status')?.setFilterValue(['Cancelled']);
                      table.getColumn('priority')?.setFilterValue(undefined);
                    } else if (val === 'onhold') {
                      table.getColumn('status')?.setFilterValue(['On Hold']);
                      table.getColumn('priority')?.setFilterValue(undefined);
                    }
                     else if (val === 'all') {
                      table.setColumnFilters([]);
                    } else if (val.startsWith('saved_')) {
                      const custom = saved.find(f => `saved_${f.id}` === val);
                      if (custom) {
                        applySaved(custom);
                        setSelectedFilterId(val);
                      }
                    }
                  }}
                >
                  <option value="all">Saved Filters</option>
                  <optgroup label="System Filters">
                    <option value="pending">My Pending Tasks</option>
                    <option value="urgent">Urgent Priority</option>
                    <option value="cancelled">Cancelled Tasks</option>
                    <option value="inprogress">In-Progress Tasks</option>
                    <option value="onhold">On Hold Tasks</option>
                    <option value="completedtoday">Completed Today</option>
                    <option value="completed15days">Completed (15 Days)</option>
                  </optgroup>
                  {saved.length > 0 && (
                    <optgroup label="My Filters">
                      {saved.map((f) => (
                        <option key={f.id} value={`saved_${f.id}`}>
                          {f.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {saved.some((f) => `saved_${f.id}` === selectedFilterId) && (
                  <button
                    onClick={async () => {
                      const id = Number(selectedFilterId.replace("saved_", ""));
                      try {
                        await deleteSaved(id);
                        setSelectedFilterId("all");
                        table.setColumnFilters([]);
                      } catch {
                        addToast("Could not delete the filter.", "error");
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                    title="Delete saved filter"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="relative">
              <button
                onClick={() => {
                  setShowColumnSettings(!showColumnSettings);
                  setShowFilters(false);
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-md transition-all",
                  showColumnSettings
                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                )}
              >
                <Columns className="w-4 h-4" />
                Columns
              </button>

              {showColumnSettings && (
                <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white border border-gray-200 rounded-lg shadow-xl p-4 animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Configure Columns
                    </h3>
                    <button
                      onClick={() => setShowColumnSettings(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-1 max-h-85 overflow-y-auto pr-1">
                    {table
                      .getAllLeafColumns()
                      .filter(
                        (column) =>
                          column.id !== "select" && column.id !== "actions",
                      )
                      .map((column, index, filteredColumns) => {
                        const isVisible = column.getIsVisible();
                        const header = column.columnDef.header as string;

                        if (!header || typeof header !== "string") return null;

                        const moveColumn = (direction: "up" | "down") => {
                          const currentOrder = [...columnOrder];
                          const currentIndex = currentOrder.indexOf(column.id);
                          const targetIndex =
                            direction === "up"
                              ? currentIndex - 1
                              : currentIndex + 1;

                          if (
                            targetIndex >= 0 &&
                            targetIndex < currentOrder.length
                          ) {
                            const targetId = currentOrder[targetIndex];
                            if (targetId === "select" || targetId === "actions")
                              return;
                            [
                              currentOrder[currentIndex],
                              currentOrder[targetIndex],
                            ] = [
                              currentOrder[targetIndex],
                              currentOrder[currentIndex],
                            ];
                            setColumnOrder(enforceColumnOrder(currentOrder));
                          }
                        };

                        return (
                          <div
                            key={column.id}
                            className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-md group"
                          >
                            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                disabled={index === 0}
                                onClick={() => moveColumn("up")}
                                className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                disabled={index === filteredColumns.length - 1}
                                onClick={() => moveColumn("down")}
                                className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>

                            <button
                              onClick={() => column.toggleVisibility()}
                              className={cn(
                                "flex-1 flex items-center gap-2 text-xs font-medium transition-colors text-left",
                                isVisible ? "text-gray-900" : "text-gray-400",
                              )}
                            >
                              {isVisible ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5" />
                              )}
                              {header}
                            </button>

                            <GripVertical className="w-3.5 h-3.5 text-gray-300 cursor-grab active:cursor-grabbing" />
                          </div>
                        );
                      })}
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between">
                    <button
                      onClick={() => {
                        table.resetColumnVisibility();
                        setColumnOrder(
                          enforceColumnOrder(
                            table.getAllLeafColumns().map((d) => d.id),
                          ),
                        );
                      }}
                      className="text-[10px] font-bold uppercase text-gray-400 hover:text-brand-primary transition-colors"
                    >
                      Reset Defaults
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("w-4 h-4", isRefreshing && "animate-spin")}
                />
                Refresh
              </button>
            )}
            {onExport && (
              <button
                onClick={() => {
                  setShowExportPanel((prev) => !prev);
                  setShowFilters(false);
                  setShowColumnSettings(false);
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-md transition-all",
                  showExportPanel
                    ? "bg-brand-primary/10 border-brand-primary text-brand-primary"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                )}
              >
                <Download className="w-4 h-4" />
                Export
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform",
                    showExportPanel && "rotate-180",
                  )}
                />
              </button>
            )}
            <button
              onClick={onAddTask}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-brand-primary border border-brand-primary rounded-md hover:bg-brand-primary/90 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        </div>

        {/* Export Panel */}
        {onExport && showExportPanel && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50/60 animate-in slide-in-from-top-2 duration-200">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  From Date
                </label>
                <input
                  type="date"
                  value={exportFromDate}
                  max={exportToDate || undefined}
                  onChange={(e) => setExportFromDate(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  To Date
                </label>
                <input
                  type="date"
                  value={exportToDate}
                  min={exportFromDate || undefined}
                  onChange={(e) => setExportToDate(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </label>
                <select
                  value={exportStatus}
                  onChange={(e) =>
                    setExportStatus(e.target.value as typeof exportStatus)
                  }
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary min-w-[140px]"
                >
                  <option value="">All Statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="OnHold">Hold</option>
                  <option value="Clarification">Clarification</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Format
                </label>
                <select
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(e.target.value as "csv" | "xlsx")
                  }
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary min-w-[140px]"
                >
                  <option value="csv">CSV (.csv)</option>
                  <option value="xlsx">Excel (.xlsx)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => {
                    setExportFromDate("");
                    setExportToDate("");
                    setExportStatus("");
                    setExportFormat("csv");
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Reset
                </button>
                <button
                  disabled={isExporting}
                  onClick={async () => {
                    if (
                      exportFromDate &&
                      exportToDate &&
                      exportFromDate > exportToDate
                    ) {
                      addToast("From Date cannot be after To Date.", "error");
                      return;
                    }
                    try {
                      await onExport({
                        fromDate: exportFromDate,
                        toDate: exportToDate,
                        status: exportStatus,
                        format: exportFormat,
                      });
                      setShowExportPanel(false);
                    } catch {
                      addToast("Export failed. Please try again.", "error");
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-brand-primary border border-brand-primary rounded-md hover:bg-brand-primary/90 transition-colors shadow-sm disabled:opacity-50"
                >
                  {isExporting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isExporting ? "Exporting…" : "Export"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Filters Panel */}
        {showFilters && (
          <div className="px-3 pb-3 flex flex-wrap gap-2 animate-in slide-in-from-top-2 duration-200">
            <div className="flex flex-wrap gap-2 items-center">
              {columnFilters.map((filter) => {
                const column = table.getColumn(filter.id);
                const header =
                  (column?.columnDef.header as string) || filter.id;

                return (
                  <div
                    key={filter.id}
                    className="flex items-center gap-1.5 px-2 py-1 bg-brand-primary/5 border border-brand-primary/20 rounded-md text-xs font-medium text-brand-primary"
                  >
                    <span className="opacity-60">{header}:</span>

                    {filter.id === "status" ||
                    filter.id === "priority" ||
                    filter.id?.startsWith("field_") ? (
                      <div className="relative">
                        <button
                          onClick={() =>
                            setOpenFilterDropdown(
                              openFilterDropdown === filter.id
                                ? null
                                : filter.id,
                            )
                          }
                          className="flex items-center gap-1 px-1 py-0.5 text-xs font-bold text-brand-primary hover:bg-brand-primary/5 rounded transition-colors outline-none"
                        >
                          <span className="truncate max-w-[150px]">
                            {Array.isArray(filter.value) &&
                            filter.value.length > 0
                              ? filter.value.join(", ")
                              : "Select..."}
                          </span>
                          <ChevronDown
                            className={cn(
                              "w-3 h-3 transition-transform",
                              openFilterDropdown === filter.id && "rotate-180",
                            )}
                          />
                        </button>

                        {openFilterDropdown === filter.id && (
                          <>
                            <div
                              className="fixed inset-0 z-[60]"
                              onClick={() => setOpenFilterDropdown(null)}
                            />
                            <div className="absolute left-0 top-full mt-1 z-[70] w-48 bg-white border border-gray-200 rounded-md shadow-xl p-1 animate-in fade-in zoom-in-95 duration-100">
                              <input
                                placeholder="Search..."
                                value={filterSearch[filter.id] || ""}
                                onChange={(e) =>
                                  setFilterSearch((prev) => ({
                                    ...prev,
                                    [filter.id]: e.target.value,
                                  }))
                                }
                                className="mb-2 h-8 border border-gray-300 rounded-md w-full text-sm px-3 py-2"
                              />
                              <div className="max-h-60 overflow-y-auto">
                                {(() => {
                                  const counts =
                                    categoricalCounts[filter.id] || {};
                                  const search = (
                                    filterSearch[filter.id] || ""
                                  ).toLowerCase();

                                  return Object.entries(counts)
                                    .filter(([val]) =>
                                      val.toLowerCase().includes(search),
                                    )
                                    .sort(([a], [b]) => {
                                      const order =
                                        filterSort[filter.id] || "asc";
                                      return order === "asc"
                                        ? a.localeCompare(b)
                                        : b.localeCompare(a);
                                    })
                                    .map(([val, count]) => {
                                      const isSelected =
                                        Array.isArray(filter.value) &&
                                        filter.value.includes(val);
                                      return (
                                        <button
                                          key={val}
                                          onClick={() => {
                                            const currentValues = Array.isArray(
                                              filter.value,
                                            )
                                              ? filter.value
                                              : [];
                                            const nextValues = isSelected
                                              ? currentValues.filter(
                                                  (v) => v !== val,
                                                )
                                              : [...currentValues, val];
                                            table
                                              .getColumn(filter.id)
                                              ?.setFilterValue(
                                                nextValues.length > 0
                                                  ? nextValues
                                                  : undefined,
                                              );
                                          }}
                                          className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] hover:bg-gray-50 rounded transition-colors text-left group"
                                        >
                                          <div className="flex items-center gap-2 flex-1">
                                            <div
                                              className={cn(
                                                "w-3.5 h-3.5 border rounded flex items-center justify-center transition-colors",
                                                isSelected
                                                  ? "bg-brand-primary border-brand-primary"
                                                  : "border-gray-300 group-hover:border-gray-400",
                                              )}
                                            >
                                              {isSelected && (
                                                <Check className="w-2.5 h-2.5 text-white" />
                                              )}
                                            </div>
                                            <span
                                              className={cn(
                                                isSelected
                                                  ? "text-brand-primary font-bold"
                                                  : "text-gray-700",
                                              )}
                                            >
                                              {val}
                                            </span>
                                          </div>
                                          <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                                            {count}
                                          </span>
                                        </button>
                                      );
                                    });
                                })()}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <input
                        type="text"
                        className="bg-transparent border-none p-0 text-xs font-bold outline-none w-20"
                        value={(filter.value as string) ?? ""}
                        onChange={(e) =>
                          table
                            .getColumn(filter.id)
                            ?.setFilterValue(e.target.value)
                        }
                        autoFocus
                      />
                    )}

                    <button
                      onClick={() =>
                        table.getColumn(filter.id)?.setFilterValue(undefined)
                      }
                      className="hover:bg-brand-primary/10 p-0.5 rounded transition-colors ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}

              <div className="flex items-center gap-2">
                <select
                  className="px-2 py-1 text-xs border border-gray-300 rounded bg-white outline-none focus:ring-1 focus:ring-brand-primary"
                  onChange={(e) => {
                    const columnId = e.target.value;
                    if (columnId) {
                      if (columnFilters.some((f) => f.id === columnId)) {
                        e.target.value = "";
                        return;
                      }

                      let defaultValue: any = "";
                      if (columnId === "status") defaultValue = [];
                      if (columnId === "priority") defaultValue = [];
                      if (columnId?.startsWith("field_")) {
                        const fieldName = columnId.replace("field_", "");
                        const field = processFields.find(
                          (f) => f.fieldName === fieldName,
                        );
                        const ft = String(field?.fieldType ?? "").toLowerCase();
                        const isCategorical =
                          ft === "dropdown" ||
                          ft === "3" ||
                          ft === "multiselect" ||
                          ft === "4";
                        defaultValue = isCategorical ? [] : "";
                      }

                      setColumnFilters((prev) => [
                        ...prev,
                        { id: columnId, value: defaultValue },
                      ]);
                      if (Array.isArray(defaultValue)) {
                        setOpenFilterDropdown(columnId);
                      }
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="">+ Add Filter</option>
                  <option value="status">Status</option>
                  <option value="priority">Priority</option>
                  {processFields
                    .filter((field) => !field.isDeleted)
                    .sort((a, b) => a.displayOrder - b.displayOrder)
                    .map((field) => (
                      <option
                        key={`field_${field.fieldName}`}
                        value={`field_${field.fieldName}`}
                      >
                        {field.fieldName}
                      </option>
                    ))}
                </select>

                {columnFilters.length > 0 && (
                  <button
                    onClick={() => table.setColumnFilters([])}
                    className="text-xs text-gray-500 hover:text-red-600 font-medium transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {columnFilters.length > 0 && (
              <div className="flex items-center gap-2">
                {isSavingFilter ? (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Filter name..."
                      className="px-2 py-1 text-xs border border-gray-300 rounded outline-none focus:border-brand-primary"
                      value={newFilterName}
                      onChange={(e) => setNewFilterName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleSaveFilter();
                        } else if (e.key === "Escape") {
                          setIsSavingFilter(false);
                        }
                      }}
                    />
                    <button
                      onClick={handleSaveFilter}
                      className="p-1 text-brand-primary hover:bg-brand-primary/10 rounded"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setIsSavingFilter(false)}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsSavingFilter(true)}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-brand-primary hover:bg-brand-primary/10 rounded transition-all"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    Save Current Filter
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bulk Actions Bar */}
        {hasSelection && (
          <div className="flex items-center justify-between px-4 py-2 bg-brand-primary/10 border-y border-brand-primary/20 animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-brand-primary">
                {selectedRows.length} rows selected
              </span>
              <div className="h-4 w-px bg-brand-primary/20" />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const rowsToUpdate = selectedRows.filter(
                      (row) => row.original.status !== "Completed",
                    );

                    if (rowsToUpdate.length === 0) {
                      addToast(
                        "All selected tasks are already completed.",
                        "info",
                      );
                      return;
                    }

                    const coreRequiredFieldNames = [
                      "statuscode",
                      "invoice",
                      "followuptype",
                    ];
                    const requiredFieldObjects = processFields
                      .filter(
                        (field) =>
                          !field.isDeleted &&
                          (field.isRequired ||
                            coreRequiredFieldNames.includes(
                              field.fieldName.toLowerCase(),
                            )),
                      )
                      .map((field) => field.fieldName);

                    if (requiredFieldObjects.length === 0) {
                      const ids = rowsToUpdate.map((r) => r.original.id);
                      handleBulkUpdate(ids, {
                        status: "Completed",
                        statusBackend: "Completed",
                      });
                      setValidationErrors({});
                      return;
                    }

                    const newValidationErrors: Record<string, Set<string>> = {};
                    const rowsWithMissingRequired = rowsToUpdate.filter(
                      (row) => {
                        const missingFields = requiredFieldObjects.filter(
                          (fieldName) => {
                            const value = row.original.taskData?.[fieldName];
                            if (value == null) return true;
                            if (typeof value === "string")
                              return value.trim() === "";
                            if (Array.isArray(value)) return value.length === 0;
                            return false;
                          },
                        );

                        if (missingFields.length > 0) {
                          newValidationErrors[row.original.id] = new Set(
                            missingFields,
                          );
                          return true;
                        }
                        return false;
                      },
                    );

                    if (rowsWithMissingRequired.length > 0) {
                      setValidationErrors(newValidationErrors);

                      const missingFieldsSummary = Array.from(
                        new Set(
                          Object.values(newValidationErrors).flatMap((s) =>
                            Array.from(s),
                          ),
                        ),
                      ).join(", ");

                      addToast(
                        `Cannot mark complete. Missing required fields: ${missingFieldsSummary}`,
                        "error",
                      );
                      return;
                    }

                    setValidationErrors({});
                    const ids = rowsToUpdate.map((r) => r.original.id);
                    handleBulkUpdate(ids, {
                      status: "Completed",
                      statusBackend: "Completed",
                    });
                    addToast(
                      `Successfully marked ${ids.length} task(s) as complete.`,
                      "success",
                    );
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-brand-primary hover:bg-brand-primary/20 rounded transition-colors"
                  title="Mark Complete (Ctrl + Shift + C)"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark Complete (Ctrl + Shift + C)
                </button>
                <button
                  onClick={() => {
                    const ids = selectedRows.map((r) => r.original.id);
                    handleBulkUpdate(ids, {
                      status: "Cancelled",
                      statusBackend: "Cancelled",
                    });
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 rounded transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Cancel
                </button>
<button
  onClick={() => {
    const ids = selectedRows.map(r => r.original.id);

    handleBulkUpdate(ids, {
      status: 'On Hold',
      statusBackend: 'OnHold'
    });

    addToast(
      `${ids.length} task(s) moved to On Hold`,
      'success'
    );
  }}
  className="flex items-center gap-1.5 px-3 py-1 rounded-md
             ring-1 ring-amber-500 text-amber-700
             hover:bg-amber-500 hover:text-white
             transition-colors text-xs font-medium
             whitespace-nowrap"
>
  <PauseCircle className="w-3.5 h-3.5" />
  On Hold
</button>
 {onRaiseClarification && (
                <button
                  onClick={() => {
                    const eligible = selectedRows.filter(
                      (r) =>
                        r.original.status !== 'Completed' &&
                        r.original.status !== 'Cancelled'
                    );
                    if (eligible.length === 0) {
                      addToast('Selected tasks are already closed.', 'info');
                      return;
                    }
                    onRaiseClarification(eligible.map((r) => r.original.taskId));
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md ring-1 ring-violet-500 text-violet-700 hover:bg-violet-500 hover:text-white transition-colors text-xs font-medium whitespace-nowrap"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  Raise Clarification
                </button>
              )}
              </div>
            </div>
            <button
              onClick={() => setRowSelection({})}
              className="text-xs font-medium text-brand-primary hover:text-brand-primary/80"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {/* Table Body with Virtualization */}
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto relative outline-none"
        tabIndex={0}
        onFocus={() => {
          if (!focusedCell && rows.length > 0) {
            if (rows[0]) {
              const fvc = rows[0].getVisibleCells().map((c) => c.column);
              setFocusedCell({ rowIndex: rows[0].id, colId: fvc[0]?.id ?? "" });
            }
          }
        }}
        style={{ overflowX: "auto", overflowY: "auto" }}
      >
        <div className="min-w-full inline-block align-middle">
          {/* Header */}
          <div
            className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm flex"
            style={{ width: table.getTotalSize() }}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <React.Fragment key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <div
                    key={header.id}
                    className="px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider select-none flex items-center relative group/header border-r border-gray-100 last:border-r-0 "
                    style={{
                      width: header.getSize(),
                      minWidth: "50px",
                      flexShrink: 0,
                      ...(header.id === "select"
                        ? {
                            position: "sticky",
                            left: 0,
                            zIndex: 60,
                            background: "white",
                            boxShadow: "2px 0 4px -2px rgba(0,0,0,0.08)",
                          }
                        : header.id === "actions"
                          ? {
                              position: "sticky",
                              right: 0,
                              zIndex: 60,
                              background: "white",
                              boxShadow: "-2px 0 4px -2px rgba(0,0,0,0.08)",
                            }
                          : {}),
                    }}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1 flex-1 min-w-0 cursor-pointer hover:text-gray-700 ",
                        header.column.getCanSort() &&
                          "cursor-pointer hover:text-gray-700 ",
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span
                        className={header.id === "select" ? "" : "truncate"}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      {{
                        asc: <ChevronUp className="w-3 h-3" />,
                        desc: <ChevronDown className="w-3 h-3" />,
                      }[header.column.getIsSorted() as string] ?? null}
                    </div>
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={cn(
                        "absolute right-0 top-0 h-full w-1 cursor-col-resize bg-gray-300 opacity-0 group-hover/header:opacity-100 transition-opacity z-20",
                        header.column.getIsResizing() &&
                          "bg-brand-primary opacity-100 w-0.5",
                      )}
                    />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>

          {/* Body */}
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const isRowFocused = focusedCell?.rowIndex === row.id;

              return (
                <div
                  key={row.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      rowId: row.original.id,
                    });
                  }}
                  className={cn(
                    "group transition-colors absolute flex items-center border-b border-gray-100",
                    row.getIsSelected()
                      ? "bg-brand-primary/5"
                      : "hover:bg-gray-50/80",
                    isRowFocused &&
                      "bg-brand-primary/10 ring-1 ring-inset ring-brand-primary/20",
                  )}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: table.getTotalSize(),
                  }}
                >
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const isCellFocused =
                      isRowFocused && focusedCell?.colId === cell.column.id;
                    const isInteractiveCol =
                      cell.column.id === "select" ||
                      cell.column.id === "actions";

                    const isDragSource =
                      dragOrigin !== null &&
                      dragOrigin.colId === cell.column.id &&
                      dragOrigin.rowIndex === virtualRow.index;
                    const isDragHighlight =
                      dragOrigin !== null &&
                      dragEndRowIndex !== null &&
                      dragOrigin.colId === cell.column.id &&
                      virtualRow.index >=
                        Math.min(dragOrigin.rowIndex, dragEndRowIndex) &&
                      virtualRow.index <=
                        Math.max(dragOrigin.rowIndex, dragEndRowIndex) &&
                      !isDragSource;

                    const isDraggableCol = cell.column.id.startsWith("field_");

                    const colFieldName = cell.column.id.startsWith("field_")
                      ? cell.column.id.replace("field_", "")
                      : null;
                    const colField = colFieldName
                      ? processFields.find((f) => f.fieldName === colFieldName)
                      : null;
                    const colIsReadOnly = colField?.isReadOnly ?? false;

                    const isThisCellEditing =
                      editingCell?.id === row.original.id &&
                      editingCell?.field === cell.column.id;
                    const showFillHandle =
                      (isCellFocused || isThisCellEditing) &&
                      isDraggableCol &&
                      !colIsReadOnly;

                    return (
                      <div
                        key={cell.id}
                        data-row={virtualRow.index}
                        data-col={cell.column.id}
                        tabIndex={
                          isInteractiveCol
                            ? -1
                            : focusedCell?.rowIndex === row.id &&
                                focusedCell?.colId === cell.column.id
                              ? 0
                              : -1
                        }
                        onFocus={(e) => {
                          if (isInteractiveCol) return;
                        }}
                        onMouseEnter={() => {
                          if (isDraggingRef.current && dragOrigin !== null) {
                            setDragEndRowIndex(virtualRow.index);
                          }
                        }}
                        className={cn(
                          "px-4 py-2.5 text-sm text-gray-700 h-full flex items-center transition-all border-r border-gray-50 last:border-r-0 relative",
                          !isInteractiveCol &&
                            isCellFocused &&
                            "bg-brand-primary/10 ring-2 ring-inset ring-brand-primary z-20",
                          isDragHighlight &&
                            "bg-blue-50 ring-1 ring-inset ring-blue-400",
                        )}
                        style={{
                          width: cell.column.getSize(),
                          minWidth: "50px",
                          flexShrink: 1,
                          ...(cell.column.id === "select"
                            ? {
                                position: "sticky",
                                left: 0,
                                zIndex: 50,
                                background: "white",
                                boxShadow: "2px 0 4px -2px rgba(0,0,0,0.08)",
                              }
                            : cell.column.id === "actions"
                              ? {
                                  position: "sticky",
                                  right: 0,
                                  zIndex: 50,
                                  background: "white",
                                  boxShadow: "-2px 0 4px -2px rgba(0,0,0,0.08)",
                                }
                              : {}),
                        }}
                        onClick={(e) => {
                          if (isInteractiveCol) return;
                          setFocusedCell({
                            rowIndex: row.id,
                            colId: cell.column.id,
                          });
                        }}
                      >
                        <div className="w-full flex">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>

                        {showFillHandle && (
                          <div
                            title="Drag to fill down"
                            className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 bg-brand-primary cursor-crosshair z-30 select-none rounded-sm"
                            style={{ boxShadow: "0 0 0 1px white" }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (pendingValueRef.current) {
                                const {
                                  taskId: pid,
                                  fieldName: pfn,
                                  value: pv,
                                } = pendingValueRef.current;
                                const pRow = rows.find(
                                  (r) => r.original.id === pid,
                                );
                                if (pRow) {
                                  const ptd = pRow.original.taskData || {};
                                  handleUpdateTask(pid, {
                                    taskData: { ...ptd, [pfn]: pv },
                                    dataChanged: { [pfn]: pv },
                                  });
                                }
                                pendingValueRef.current = null;
                              }
                              const sourceFieldName = cell.column.id.replace(
                                "field_",
                                "",
                              );
                              const sourceValue =
                                row.original.taskData?.[sourceFieldName] ?? "";
                              isDraggingRef.current = true;
                              setDragOrigin({
                                rowIndex: virtualRow.index,
                                colId: cell.column.id,
                                value: sourceValue,
                                fieldName: sourceFieldName,
                              });
                              setDragEndRowIndex(virtualRow.index);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Search className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm">No tasks found matching your criteria</p>
          </div>
        )}
        {contextMenu && (
          <>
          <div className='fixed inset-0 z-[90]' onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null);}} />
<div
  className="fixed z-[100] bg-white border border-gray-200 rounded-md shadow-xl py-1 min-w-[180px]"
  style={{ top: contextMenu.y, left: contextMenu.x }}
>
  <button
    onClick={() => handleDuplicateRow(contextMenu.rowId, "above")}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 text-left"
  >
    <Copy className="w-3.5 h-3.5" />
    Duplicate row above
  </button>

  <button
    onClick={() => handleDuplicateRow(contextMenu.rowId, "below")}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 text-left"
  >
    <Copy className="w-3.5 h-3.5" />
    Duplicate row below
  </button>

  {onDeleteTask && deletableTaskIds?.has(contextMenu.rowId) && (
    <>
      <div className="h-px bg-gray-100 my-1" />
      <button
        onClick={() => {
          onDeleteTask(contextMenu.rowId);
          setContextMenu(null);
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Delete duplicated row
      </button>
    </>
  )}
</div>          </>
          
        )

        }
      </div>

      {/* Status Footer */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-t border-gray-200 text-[11px] text-gray-500">
        <div className="flex items-center gap-4 flex-wrap">
          <span>
            Showing{" "}
            <span className="font-semibold text-gray-900">{rows.length}</span>
            {' '}of{' '}
            <span className="font-semibold text-gray-900">
              {totalCount ?? data.length}
            </span>{' '}
            tasks
          </span>

          {columnFilters.length > 0 && (
            <span className="flex items-center gap-1 text-brand-primary font-medium">
              <FilterIcon className="w-3 h-3" />
              {columnFilters.length} filters active
            </span>
          )}

         <div className="h-4 w-px bg-gray-300" />

           <div className="cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200" onClick={() => {
  setSelectedFilterId('completedtoday');
  setCompletedDateFilter('today');
  table.getColumn('status')?.setFilterValue(['Completed']);
}}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="font-medium">
              Today:
            </span>
            <span className="font-bold">
              {completedTodayCount}
            </span>
          </div>

          <div className="cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200" onClick={() => {
  setSelectedFilterId('completed15days');
  setCompletedDateFilter('15days');
  table.getColumn('status')?.setFilterValue(['Completed']);
}}>
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="font-medium">
              Last 15 Days:
            </span>
            <span className="font-bold">
              {completedLast15DaysCount}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="opacity-60 italic">All open tasks loaded</span>
        </div>
      </div>
    </div>
  );
};
