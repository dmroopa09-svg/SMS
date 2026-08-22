# App.tsx — switch sticky notes to the database

Six edits. Each replaces an exact block from your current file. The sticky-note
PANEL JSX does not change — `noteService` returns the same
`{ id, text, createdAt }` shape localStorage used.

Prerequisites: the `sticky-notes-db` drop applied (table, entity, service,
controller, `noteService.ts`, `API_ENDPOINTS.notes`, DbSet, Program.cs).

---

## EDIT 0 — delete the broken import

DELETE this line entirely:

```tsx
import { CreateTaskRequest, TaskPriority } from '../services/taskService';
```

Wrong path (`../services` from `src/` does not exist) and both names are unused.
Unrelated to notes, but it will fail the build.

---

## EDIT 1 — add the import

FIND:
```tsx
import { useSessionKeepAlive } from "./hooks/useSessionKeepAlive";
```

REPLACE WITH:
```tsx
import { useSessionKeepAlive } from "./hooks/useSessionKeepAlive";
import { noteService, StickyNote } from "./services/noteService";
```

---

## EDIT 2 — replace the state initialiser

FIND:
```tsx
  const [stickyNotes, setStickyNotes] = useState<
    { id: string; text: string; createdAt: string }[]
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("stickyNotes") ?? "[]");
    } catch {
      return [];
    }
  });
```

REPLACE WITH:
```tsx
  // Loaded from the server on login. localStorage could not survive an agent
  // moving to a different machine, or policy clearing browsing data at logout —
  // which is why notes were disappearing overnight.
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
```

---

## EDIT 3 — load notes on login, migrating anything left locally

FIND (the clarification badge poller, immediately above the process loader):
```tsx
  // ── Load processes on mount ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadProcesses = async () => {
```

REPLACE WITH:
```tsx
  // ── Load sticky notes ──
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    (async () => {
      setNotesLoading(true);
      try {
        // One-time move of anything written before this change shipped.
        // noteService clears localStorage only AFTER the server confirms, so a
        // failure here leaves the notes in place and the next load retries.
        const migrated = await noteService.migrateLocalNotes().catch(() => 0);

        const notes = await noteService.getNotes();
        if (cancelled) return;

        setStickyNotes(notes);
        if (migrated > 0) {
          addToast(`${migrated} saved note(s) moved to your account`, "success");
        }
      } catch (error) {
        console.error("Failed to load notes:", error);
        if (!cancelled) addToast("Failed to load notes", "error");
      } finally {
        if (!cancelled) setNotesLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, addToast]);

  // ── Load processes on mount ──
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadProcesses = async () => {
```

---

## EDIT 4 — replace both note handlers

FIND:
```tsx
  const handleSaveStickyNote = () => {
    if (!stickyNoteText.trim()) return;
    const newNote = {
      id: crypto.randomUUID(),
      text: stickyNoteText.trim(),
      createdAt: new Date().toLocaleString(),
    };
    const updated = [newNote, ...stickyNotes];
    setStickyNotes(updated);
    localStorage.setItem("stickyNotes", JSON.stringify(updated));
    setStickyNoteText("");
  };

  const handleDeleteStickyNote = (id: string) => {
    const updated = stickyNotes.filter((n) => n.id !== id);
    setStickyNotes(updated);
    localStorage.setItem("stickyNotes", JSON.stringify(updated));
  };
```

REPLACE WITH:
```tsx
  const handleSaveStickyNote = async () => {
    const text = stickyNoteText.trim();
    if (!text) return;

    // Clear the box immediately — an agent on a call should not wait on a round
    // trip. Restored below if the save fails.
    setStickyNoteText("");

    try {
      const saved = await noteService.createNote(text, selectedProcess?.id);
      setStickyNotes((prev) => [saved, ...prev]);
    } catch (error) {
      console.error("Failed to save note:", error);
      setStickyNoteText(text);
      addToast("Failed to save note", "error");
    }
  };

  const handleDeleteStickyNote = async (id: string) => {
    const previous = stickyNotes;
    setStickyNotes((prev) => prev.filter((n) => n.id !== id)); // optimistic

    try {
      await noteService.deleteNote(Number(id));
    } catch (error) {
      console.error("Failed to delete note:", error);
      setStickyNotes(previous); // rollback
      addToast("Failed to delete note", "error");
    }
  };
```

NOTE: `handleSaveStickyNote` is now async. The Ctrl+Enter handler and the Save
button both call it without awaiting, which is correct — no change needed there.

---

## EDIT 5 — replace the "Clear all" handler

FIND:
```tsx
                          onClick={() => {
                            setStickyNotes([]);
                            localStorage.removeItem("stickyNotes");
                          }}
```

REPLACE WITH:
```tsx
                          onClick={async () => {
                            const previous = stickyNotes;
                            setStickyNotes([]);
                            try {
                              await noteService.deleteAll();
                            } catch (error) {
                              console.error("Failed to clear notes:", error);
                              setStickyNotes(previous);
                              addToast("Failed to clear notes", "error");
                            }
                          }}
```

---

## EDIT 6 — loading state in the list view

Without this, `notesLoading` is declared but never read — TS6133 under
noUnusedLocals.

FIND:
```tsx
                {stickyView === "list" && (
                  <div className="flex flex-col flex-1 overflow-hidden">
                    {stickyNotes.length === 0 ? (
```

REPLACE WITH:
```tsx
                {stickyView === "list" && (
                  <div className="flex flex-col flex-1 overflow-hidden">
                    {notesLoading ? (
                      <div className="flex items-center justify-center py-10 text-yellow-500 gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs">Loading notes…</span>
                      </div>
                    ) : stickyNotes.length === 0 ? (
```

`Loader2` is already imported.

---

## After applying

Search App.tsx for `stickyNotes` in localStorage — there should be ZERO matches:

    localStorage.getItem("stickyNotes")
    localStorage.setItem("stickyNotes"
    localStorage.removeItem("stickyNotes")

The only remaining reference to that key is inside `noteService.migrateLocalNotes()`,
which reads it once and deletes it.

## Test

1. Add two notes, hard-refresh -> both still there
2. Log in from a DIFFERENT machine -> same notes appear
   (this is the whole point; localStorage could never do it)
3. Delete one, refresh -> stays deleted
4. Before deploying, seed localStorage in DevTools:
   localStorage.setItem('stickyNotes', JSON.stringify([{id:'1',text:'old note',createdAt:'7/1/2026, 10:00:00 AM'}]))
   then load -> "1 saved note(s) moved to your account", key gone
5. Reload twice -> no duplicates (the server dedupes on text)

## Separate, while you are in this file

- `function cn(arg0: string, arg1: string) { throw new Error(...) }` sits just
  above the return and shadows the imported `cn` for the whole component.
  Nothing calls it today. Delete it.
- Check `LayoutDashboard`, `mapTaskStatusToBackend`, `reworkService`,
  `breakService`, `getUserIdFromStorage` — several look unused now and are
  TS6133 candidates.
