import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, X, ArrowRight, Loader2, Ban, AlertCircle } from 'lucide-react';
import { ReasonDto, reasonService } from '../services/ReasonService';
import { breakService, getUserIdFromStorage } from '../services/breakService';
import { workPolicyService, AgentReasonPolicy } from '../services/workPolicyService';

interface LogoutReasonModalProps {
  isOpen: boolean;
  processId: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** A reason plus what the process policy says about it today. */
type ReasonOption = ReasonDto & {
  policy?: AgentReasonPolicy;
  blocked: boolean;
  blockedText?: string;
};

export const LogoutReasonModal: React.FC<LogoutReasonModalProps> = ({
  isOpen,
  processId,
  onClose,
  onConfirm,
}) => {
  const [reasons, setReasons] = useState<ReasonDto[]>([]);
  const [policies, setPolicies] = useState<AgentReasonPolicy[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = getUserIdFromStorage();

  // Reload every time the modal opens: "used today" changes after each break.
  useEffect(() => {
    if (!isOpen || !processId) return;
    let cancelled = false;

    setSelectedId(null);
    setComment('');
    setError(null);

    reasonService
      .getReasons(processId, 1)
      .then((r) => !cancelled && setReasons(r))
      .catch((err) => console.error('LogoutReasonModal: Error fetching reasons:', err));

    workPolicyService
      .getMyReasons(processId)
      .then((p) => !cancelled && setPolicies(p))
      .catch(() => {
        // No policy info: show every reason; the server still enforces the limits.
        if (!cancelled) setPolicies([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, processId]);

  const options = useMemo<ReasonOption[]>(() => {
    const byId = new Map(policies.map((p) => [p.reasonId, p]));
    return reasons
      .map((r) => {
        const policy = byId.get(r.reasonId);
        if (policy && !policy.isEnabled) return null; // turned off for this process: hide it
        const limitReached = policy?.canStart === false;
        return {
          ...r,
          policy,
          blocked: limitReached,
          blockedText: limitReached
            ? `Today's limit reached (${policy?.usedToday ?? 0}/${policy?.maxOccurrencesPerDay ?? 0})`
            : undefined,
        } as ReasonOption;
      })
      .filter((x): x is ReasonOption => x !== null);
  }, [reasons, policies]);

  const selected = options.find((o) => o.reasonId === selectedId) ?? null;
  const needsComment = !!selected?.requiresComment;
  const canConfirm = !!selected && !selected.blocked && !submitting && (!needsComment || comment.trim().length > 0);

  const handleConfirm = async () => {
    if (!selected || !canConfirm) return;
    if (!userId) {
      setError('Your session details are missing. Please sign in again.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await breakService.startBreak({
        userId,
        processId,
        reasonId: selected.reasonId,
        reasonType: 1, // 1 = Break / sign-off
        reasonCode: selected.reasonCode,
        allowedDurationMin: selected.policy?.allowedDurationMin ?? selected.allowedDurationMin,
        comment,
      });
      onConfirm(selected.reasonCode.toLowerCase());
    } catch (err: any) {
      // The server's message, e.g. 'You've already taken "Lunch Break" 1 time(s) today. The limit is 1.'
      setError(err?.message || 'Could not start this break. Please try again.');
      // Refresh counts - the reason may have just hit its limit.
      workPolicyService.getMyReasons(processId).then(setPolicies).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={submitting ? undefined : onClose}
            className="absolute inset-0 bg-brand-black/40 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden"
          >
            <div className="p-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
                    <LogOut className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Sign Out</h2>
                    <p className="text-sm text-gray-500 font-medium">Select a reason for leaving</p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  disabled={submitting}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Reasons */}
              <div className="grid gap-3">
                {options.map((reason) => {
                  const isSelected = selectedId === reason.reasonId;
                  const allowed = reason.policy?.allowedDurationMin ?? reason.allowedDurationMin;
                  const max = reason.policy?.maxOccurrencesPerDay;
                  const used = reason.policy?.usedToday ?? 0;

                  return (
                    <button
                      key={reason.reasonId}
                      disabled={reason.blocked || submitting}
                      onClick={() => {
                        setSelectedId(reason.reasonId);
                        setError(null);
                      }}
                      title={reason.blockedText}
                      className={`
                        w-full flex items-center justify-between gap-3 p-4 rounded-2xl border-2 transition-all text-left
                        ${
                          reason.blocked
                            ? 'border-gray-50 bg-gray-50 opacity-60 cursor-not-allowed'
                            : isSelected
                              ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                              : 'border-gray-50 bg-gray-50/50 hover:border-gray-200'
                        }
                      `}
                    >
                      <div className="flex-1 min-w-0">
                        <span
                          className={`block font-bold text-sm ${
                            reason.blocked ? 'text-gray-400' : isSelected ? 'text-brand-primary' : 'text-gray-700'
                          }`}
                        >
                          {reason.reasonLabel}
                        </span>
                        {(reason.blocked || allowed || max) && (
                          <span className={`block text-[11px] mt-0.5 ${reason.blocked ? 'text-red-500' : 'text-gray-400'}`}>
                            {reason.blocked
                              ? reason.blockedText
                              : [
                                  allowed ? `${allowed} min` : null,
                                  max ? `${used}/${max} used today` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                          </span>
                        )}
                      </div>

                      {reason.blocked ? (
                        <Ban className="w-4 h-4 text-gray-300 shrink-0" />
                      ) : (
                        isSelected && (
                          <motion.div
                            layoutId="check"
                            className="w-6 h-6 bg-brand-primary rounded-full flex items-center justify-center text-white shrink-0"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </motion.div>
                        )
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Comment */}
              {needsComment && (
                <textarea
                  className="mt-4 w-full border p-3 rounded-xl"
                  placeholder="Enter reason..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={submitting}
                />
              )}

              {/* Error from the server (limit reached, etc.) */}
              {error && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Actions */}
              <div className="mt-8 flex gap-3">
                <button
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>

                <button
                  disabled={!canConfirm}
                  onClick={handleConfirm}
                  className={`
                    flex-1 py-4 px-6 rounded-2xl font-bold transition-all shadow-lg flex items-center justify-center gap-2
                    ${
                      canConfirm
                        ? 'bg-brand-primary text-white shadow-brand-primary/20 hover:bg-brand-primary/90'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                    }
                  `}
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
