import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Save, ShieldCheck, RotateCcw } from "lucide-react";
import { apiClient } from "../api/client";
import type { ProcessDto } from "../types";
import { cn } from "../types";
import { useToast } from "../components/Toast";
import {
  workPolicyApi,
  REASON_TYPE_LABELS,
  type ProcessWorkSettings,
  type ReasonPolicy,
} from "../api/workPolicy";

const TIME_ZONES = [
  "Central Standard Time",
  "Eastern Standard Time",
  "Mountain Standard Time",
  "Pacific Standard Time",
  "India Standard Time",
];

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const inputCls =
  "w-full px-2 py-1.5 text-sm bg-white border border-zinc-200 rounded-md outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400";

/**
 * Per-process work policy: shift times, presence thresholds, inactivity popup, and the
 * ProcessReasonPolicy row for every reason (limits, allowed window, max per day, approval).
 */
interface WorkPolicySettingsProps {
  /**
   * Set when shown as a tab inside a process's detail page: the policy is for this process only,
   * the process picker and page header are hidden.
   */
  processId?: number;
}

export default function WorkPolicySettings({ processId: fixedProcessId }: WorkPolicySettingsProps = {}) {
  const { showToast } = useToast();
  const embedded = !!fixedProcessId;
  const [processes, setProcesses] = useState<ProcessDto[]>([]);
  const [processId, setProcessId] = useState<number | null>(fixedProcessId ?? null);
  const [settings, setSettings] = useState<ProcessWorkSettings | null>(null);
  const [policies, setPolicies] = useState<ReasonPolicy[]>([]);
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Follow the parent page if it switches process.
  useEffect(() => {
    if (fixedProcessId) setProcessId(fixedProcessId);
  }, [fixedProcessId]);

  useEffect(() => {
    if (embedded) return; // the detail page already knows its process
    apiClient
      .getProcesses()
      .then((list) => {
        setProcesses(list);
        if (list.length > 0) setProcessId(list[0].processId);
      })
      .catch(() => showToast("Failed to load processes", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (pid: number) => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([workPolicyApi.getSettings(pid), workPolicyApi.getReasons(pid)]);
      setSettings(s);
      setPolicies(p);
      setOriginal(JSON.stringify({ s, p }));
    } catch {
      showToast("Failed to load the policy for this process", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (processId) load(processId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processId]);

  const dirty = useMemo(
    () => !!settings && JSON.stringify({ s: settings, p: policies }) !== original,
    [settings, policies, original],
  );

  const grouped = useMemo(() => {
    const map = new Map<number, ReasonPolicy[]>();
    for (const p of policies) {
      if (!map.has(p.reasonType)) map.set(p.reasonType, []);
      map.get(p.reasonType)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [policies]);

  const setS = <K extends keyof ProcessWorkSettings>(key: K, value: ProcessWorkSettings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  const setP = <K extends keyof ReasonPolicy>(reasonId: number, key: K, value: ReasonPolicy[K]) =>
    setPolicies((prev) => prev.map((p) => (p.reasonId === reasonId ? { ...p, [key]: value } : p)));

  const save = async () => {
    if (!processId || !settings) return;
    setSaving(true);
    try {
      const [s, p] = await Promise.all([
        workPolicyApi.saveSettings(processId, settings),
        workPolicyApi.saveReasons(processId, policies),
      ]);
      setSettings(s);
      setPolicies(p);
      setOriginal(JSON.stringify({ s, p }));
      showToast("Policy saved", "success");
    } catch (err: any) {
      showToast(err?.message || "Failed to save the policy", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={embedded ? "space-y-6" : "h-full overflow-auto bg-white p-6"}>
      <div className={embedded ? "space-y-6" : "max-w-7xl mx-auto space-y-6"}>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {embedded ? (
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Work Policy</h2>
              <p className="text-sm text-zinc-500">Shift times, break limits and what needs supervisor approval for this process</p>
            </div>
          ) : (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Work Policy</h1>
              <p className="text-sm text-zinc-500">Shift times, break limits and what needs supervisor approval</p>
            </div>
          </div>
          )}
          <div className="flex items-center gap-2">
            {!embedded && (
            <select
              value={processId ?? ""}
              onChange={(e) => setProcessId(Number(e.target.value))}
              className="px-3 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg outline-none"
            >
              {processes.map((p) => (
                <option key={p.processId} value={p.processId}>
                  {p.processName}
                </option>
              ))}
            </select>
            )}
            <button
              onClick={() => processId && load(processId)}
              disabled={!dirty || saving}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
              Discard
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>

        {loading || !settings ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        ) : (
          <>
            {!settings.isSaved && (
              <div className="px-4 py-3 text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                This process has no saved policy yet. The values below are the defaults; press Save to apply them.
              </div>
            )}

            {/* Shift & presence */}
            <section className="border border-zinc-100 rounded-2xl p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900 mb-4">
                <Clock className="w-4 h-4 text-zinc-400" /> Shift & activity
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Time zone</span>
                  <select value={settings.timeZoneId} onChange={(e) => setS("timeZoneId", e.target.value)} className={inputCls}>
                    {TIME_ZONES.map((tz) => (
                      <option key={tz}>{tz}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Shift start</span>
                  <input type="time" value={settings.shiftStartTime ?? ""} onChange={(e) => setS("shiftStartTime", e.target.value || null)} className={inputCls} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Login grace (min)</span>
                  <input type="number" min={0} value={settings.loginGraceMin} onChange={(e) => setS("loginGraceMin", numOrNull(e.target.value) ?? 0)} className={inputCls} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Shift end</span>
                  <input type="time" value={settings.shiftEndTime ?? ""} onChange={(e) => setS("shiftEndTime", e.target.value || null)} className={inputCls} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Logout grace (min)</span>
                  <input type="number" min={0} value={settings.logoutGraceMin} onChange={(e) => setS("logoutGraceMin", numOrNull(e.target.value) ?? 0)} className={inputCls} />
                </label>
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Late login / early logout</span>
                  <div className="flex flex-col gap-1 pt-1">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={settings.shiftRequiresApproval} onChange={(e) => setS("shiftRequiresApproval", e.target.checked)} />
                      Needs approval
                    </label>
                    <label className={cn("flex items-center gap-2", !settings.shiftRequiresApproval && "opacity-40")}>
                      <input type="checkbox" disabled={!settings.shiftRequiresApproval} checked={settings.shiftAutoApprove} onChange={(e) => setS("shiftAutoApprove", e.target.checked)} />
                      Auto-approve
                    </label>
                  </div>
                </div>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Idle after (min)</span>
                  <input type="number" min={1} value={settings.idleAfterMinutes} onChange={(e) => setS("idleAfterMinutes", numOrNull(e.target.value) ?? 1)} className={inputCls} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Offline after (sec)</span>
                  <input type="number" min={60} step={30} value={settings.offlineAfterSeconds} onChange={(e) => setS("offlineAfterSeconds", numOrNull(e.target.value) ?? 60)} className={inputCls} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-zinc-500">Inactivity popup (min)</span>
                  <input type="number" min={1} value={settings.inactivityPromptMinutes} onChange={(e) => setS("inactivityPromptMinutes", numOrNull(e.target.value) ?? 1)} className={inputCls} />
                </label>
              </div>
            </section>

            {/* Reasons */}
            {grouped.map(([type, rows]) => (
              <section key={type} className="border border-zinc-100 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50/60">
                  <h2 className="text-base font-bold text-zinc-900">{REASON_TYPE_LABELS[type] ?? `Type ${type}`}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                        <th className="px-4 py-3">Reason</th>
                        <th className="px-3 py-3">On</th>
                        <th className="px-3 py-3">Allowed (min)</th>
                        <th className="px-3 py-3">Max (min)</th>
                        <th className="px-3 py-3">Allowed from</th>
                        <th className="px-3 py-3">Allowed to</th>
                        <th className="px-3 py-3">Max / day</th>
                        <th className="px-3 py-3">Needs approval</th>
                        <th className="px-3 py-3">Auto-approve</th>
                        <th className="px-3 py-3">Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {rows.map((p) => (
                        <tr key={p.reasonId} className={cn(!p.isEnabled && "opacity-50")}>
                          <td className="px-4 py-2">
                            <div className="font-semibold text-zinc-900">{p.reasonLabel}</div>
                            <div className="text-[11px] text-zinc-400">
                              {p.reasonCode}
                              {!p.hasPolicy && " · default"}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={p.isEnabled} onChange={(e) => setP(p.reasonId, "isEnabled", e.target.checked)} />
                          </td>
                          <td className="px-3 py-2 w-24">
                            <input type="number" min={0} value={p.allowedDurationMin ?? ""} onChange={(e) => setP(p.reasonId, "allowedDurationMin", numOrNull(e.target.value))} className={inputCls} />
                          </td>
                          <td className="px-3 py-2 w-24">
                            <input type="number" min={0} value={p.maxDurationMin ?? ""} onChange={(e) => setP(p.reasonId, "maxDurationMin", numOrNull(e.target.value))} className={inputCls} />
                          </td>
                          <td className="px-3 py-2 w-32">
                            <input type="time" value={p.allowedStartTime ?? ""} onChange={(e) => setP(p.reasonId, "allowedStartTime", e.target.value || null)} className={inputCls} />
                          </td>
                          <td className="px-3 py-2 w-32">
                            <input type="time" value={p.allowedEndTime ?? ""} onChange={(e) => setP(p.reasonId, "allowedEndTime", e.target.value || null)} className={inputCls} />
                          </td>
                          <td className="px-3 py-2 w-24">
                            <input type="number" min={0} placeholder="No limit" value={p.maxOccurrencesPerDay ?? ""} onChange={(e) => setP(p.reasonId, "maxOccurrencesPerDay", numOrNull(e.target.value))} className={inputCls} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={p.requiresApproval} onChange={(e) => setP(p.reasonId, "requiresApproval", e.target.checked)} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="checkbox" disabled={!p.requiresApproval} checked={p.autoApprove} onChange={(e) => setP(p.reasonId, "autoApprove", e.target.checked)} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={p.isPaidBreak} onChange={(e) => setP(p.reasonId, "isPaidBreak", e.target.checked)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            <p className="text-xs text-zinc-400">
              Breaches (over the allowed minutes, outside the allowed time, late login, early logout) never stop the agent.
              With "Needs approval" they go to the Approvals page; with "Auto-approve" they are recorded and approved
              automatically. "Max / day" does block: the agent can't start that reason again once the limit is reached.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
