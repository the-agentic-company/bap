import { msg } from "gt-react";
import { Clock, Mail, Play, Webhook } from "lucide-react";

export const TRIGGER_TYPE_OPTIONS = [
  { value: "manual", label: msg("Manual"), icon: Play },
  { value: "schedule", label: msg("Scheduled"), icon: Clock },
  { value: "email", label: msg("Email"), icon: Mail },
  { value: "webhook", label: msg("Webhook"), icon: Webhook },
] as const;
