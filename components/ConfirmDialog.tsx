"use client";

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "キャンセル",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-white/10 bg-panel p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-bold">{title}</h2>
        <p className="mb-6 text-sm text-white/60">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-full border border-white/15 px-4 py-2 font-semibold hover:bg-white/10"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-full bg-red-500 px-4 py-2 font-bold text-white hover:bg-red-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
