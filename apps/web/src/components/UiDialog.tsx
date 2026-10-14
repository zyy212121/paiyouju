import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface UiDialogField {
  readonly expectedValue?: string;
  readonly id: string;
  readonly initialValue?: string;
  readonly label: string;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly placeholder?: string;
}

export function UiDialog({
  busy = false,
  cancelLabel = "取消",
  confirmLabel = "确认",
  danger = false,
  description,
  fields = [],
  onCancel,
  onConfirm,
  open,
  title,
}: {
  readonly busy?: boolean;
  readonly cancelLabel?: string;
  readonly confirmLabel?: string;
  readonly danger?: boolean;
  readonly description?: string;
  readonly fields?: readonly UiDialogField[];
  readonly onCancel: () => void;
  readonly onConfirm: (values: Readonly<Record<string, string>>) => void | Promise<void>;
  readonly open: boolean;
  readonly title: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const initialValueSignature = JSON.stringify(fields.map((field) => [field.id, field.initialValue ?? ""]));
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(JSON.parse(initialValueSignature) as readonly (readonly [string, string])[]));
  }, [initialValueSignature, open]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onCancel, open]);

  if (!open) return null;
  const normalizedValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
  const valid = fields.every((field) => {
    const value = normalizedValues[field.id] ?? "";
    return value.length >= (field.minLength ?? 0)
      && value.length <= (field.maxLength ?? 200)
      && (field.expectedValue === undefined || value === field.expectedValue);
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    void onConfirm(normalizedValues);
  }

  function backdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target && !busy) onCancel();
  }

  return createPortal(
    <div className="modal-backdrop ui-dialog-backdrop" onMouseDown={backdropClick}>
      <form aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className="modal-card ui-dialog-card" onSubmit={submit} role="dialog">
        <div className="ui-dialog-heading">
          <span aria-hidden="true" className={danger ? "ui-dialog-icon is-danger" : "ui-dialog-icon"}><AlertTriangle size={20} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="ui-dialog-title" id={titleId}>{title}</h2>
            {description ? <p className="ui-dialog-description" id={descriptionId}>{description}</p> : null}
          </div>
          <button aria-label="关闭" className="ui-dialog-close" disabled={busy} onClick={onCancel} type="button"><X size={19} /></button>
        </div>
        {fields.length > 0 ? <div className="ui-dialog-fields">{fields.map((field) => {
          const inputId = `${titleId}-${field.id}`;
          const hintId = field.expectedValue ? `${inputId}-hint` : undefined;
          return <label className="ui-dialog-field" htmlFor={inputId} key={field.id}>
            <span>{field.label}</span>
            <input
              aria-describedby={hintId}
              aria-label={field.label}
              autoFocus={field === fields[0]}
              className="field"
              disabled={busy}
              id={inputId}
              maxLength={field.maxLength ?? 200}
              minLength={field.minLength}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
              placeholder={field.placeholder}
              required={(field.minLength ?? 0) > 0 || field.expectedValue !== undefined}
              value={values[field.id] ?? ""}
            />
            {field.expectedValue ? <small id={hintId}>必须准确输入“{field.expectedValue}”</small> : null}
          </label>;
        })}</div> : null}
        <div className="ui-dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">{cancelLabel}</button>
          <button autoFocus={fields.length === 0} className={danger ? "danger-button" : "primary-button"} disabled={busy || !valid} type="submit">{busy ? "处理中…" : confirmLabel}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
