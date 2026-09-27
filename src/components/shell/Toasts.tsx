import { useToasts } from "../../stores/errors";
import { Icon } from "../common/Icon";
import styles from "./Shell.module.css";

/**
 * Where anything that went wrong ends up.
 *
 * Not dismissed on a timer: a failure the user missed is worse than one
 * cluttering the corner.
 */
export function Toasts() {
  const toasts = useToasts((store) => store.toasts);
  const dismiss = useToasts((store) => store.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${
            toast.kind === "error" ? styles.toastError : styles.toastInfo
          }`}
        >
          <Icon name={toast.kind === "error" ? "circle-alert" : "info"} size={14} />
          <span className={styles.toastMessage}>{toast.message}</span>
          <button
            type="button"
            className={styles.toastClose}
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
