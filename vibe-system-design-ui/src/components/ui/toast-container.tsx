import { useToast } from "../../lib/toast";
import { Alert, AlertDescription } from "./alert";

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Alert variant="default" className="w-64 min-w-0">
            <AlertDescription className="text-center py-1">
              {toast.message}
            </AlertDescription>
          </Alert>
        </div>
      ))}
    </div>
  );
}