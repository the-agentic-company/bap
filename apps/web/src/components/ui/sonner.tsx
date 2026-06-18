import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToastClassnames, type ToasterProps } from "sonner";

const TOASTER_ICONS = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />,
};

const TOASTER_STYLE = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius)",
} as React.CSSProperties;

const TOASTER_CLASS_NAMES = {
  toast: "border-border bg-popover text-popover-foreground shadow-lg",
  title: "text-popover-foreground",
  description: "!text-muted-foreground",
  actionButton: "!bg-primary !text-primary-foreground",
  cancelButton: "!bg-muted !text-foreground",
  closeButton: "!border-border !bg-popover !text-popover-foreground",
} satisfies ToastClassnames;

const TOASTER_OPTIONS = {
  classNames: TOASTER_CLASS_NAMES,
} satisfies ToasterProps["toastOptions"];

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={TOASTER_ICONS}
      style={TOASTER_STYLE}
      toastOptions={TOASTER_OPTIONS}
      {...props}
    />
  );
};

export { Toaster };
