import { T } from "gt-react";
import { type SyntheticEvent, useMemo } from "react";
import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import { getCoworkerTriggerLabel } from "./coworker-trigger-label";

export type CoworkerCardData = {
  name?: string | null;
  username?: string | null;
  description?: string | null;
  status: "on" | "off";
  triggerType: string;
  schedule?: CoworkerSchedule | null;
  isPinned?: boolean;
  sharedAt?: Date | string | null;
  publishedAt?: Date | string | null;
  visibility?: "private" | "workspace";
  createdByUserId?: string | null;
  createdByNameSnapshot?: string | null;
  createdByAvatarSnapshot?: string | null;
  creatorIsActiveMember?: boolean;
  usedBy?: {
    id: string;
    name: string;
    image?: string | null;
  }[];
  recentRuns?: {
    id?: string;
    status: string;
    startedAt?: Date | string | null;
  }[];
};

const EMPTY_USED_BY: NonNullable<CoworkerCardData["usedBy"]> = [];

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function formatDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffH < 24) {
    return `${diffH}h ago`;
  }
  if (diffD < 7) {
    return `${diffD}d ago`;
  }
  return date.toLocaleDateString();
}

export function getCoworkerDisplayName(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "New Coworker";
}

function PersonAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const avatarStyle = useMemo(
    () => (image ? { backgroundImage: `url("${image}")` } : undefined),
    [image],
  );

  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted inline-flex shrink-0 items-center justify-center rounded-full bg-cover bg-center font-medium",
        className,
      )}
      style={avatarStyle}
    >
      {image ? null : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

type CoworkerPerson = NonNullable<CoworkerCardData["usedBy"]>[number] & {
  isCreator?: boolean;
  isFormerMember?: boolean;
};

function sortCoworkerPeople(people: CoworkerPerson[]) {
  return people.toSorted((left, right) => {
    if (left.isCreator !== right.isCreator) {
      return left.isCreator ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function CoworkerUsers({ users }: { users: CoworkerPerson[] }) {
  const visibleUsers = users.slice(0, 4);
  const names = users.map((person) => person.name).join(", ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted focus-visible:ring-ring flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[10px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label={users.length > 0 ? `Used by ${names}` : "Used by no one yet"}
          onClick={stopPropagation}
          onKeyDown={stopPropagation}
        >
          <span className="text-muted-foreground">
            <T>Used by</T> {users.length}
          </span>
          {visibleUsers.length > 0 ? (
            <span className="flex -space-x-1.5">
              {visibleUsers.map((person) => (
                <PersonAvatar
                  key={person.id}
                  name={person.name}
                  image={person.image}
                  className="border-card size-4 border text-[7px]"
                />
              ))}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2" onClick={stopPropagation}>
        <p className="px-2 py-1.5 text-sm font-medium">
          <T>Used by</T>
        </p>
        {users.length > 0 ? (
          <ul className="max-h-64 overflow-auto py-1">
            {users.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
              >
                <PersonAvatar
                  name={person.name}
                  image={person.image}
                  className="size-6 text-[10px]"
                />
                <span className="truncate">{person.name}</span>
                {person.isCreator ? (
                  <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
                    <T>Creator</T>
                    {person.isFormerMember ? " · Former member" : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-2 py-2 text-xs">
            <T>No one has run this coworker yet.</T>
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Shared visual content for coworker cards.
 * Used by the main coworkers page card.
 * Does NOT render a wrapper element — the caller provides the container (div, Link, etc.)
 * along with any interactive controls (dropdown menu, status toggle, action buttons).
 */
export function CoworkerCardContent({
  coworker,
  statusSlot,
  actionsSlot,
  badgesSlot,
  runsSlot,
  footerSlot,
}: {
  coworker: CoworkerCardData;
  /** Top-right status badge area. If omitted, renders a default on/off pill. */
  statusSlot?: React.ReactNode;
  /** Extra action buttons in the header row (e.g. dropdown menu). Rendered before the status slot. */
  actionsSlot?: React.ReactNode;
  /** Extra badges after the trigger badge (e.g. integration icons, skill count). */
  badgesSlot?: React.ReactNode;
  /** Runs section override. If omitted, renders the default static last-run text. */
  runsSlot?: React.ReactNode;
  /** Footer row override. If omitted, renders the default "Coworker" label. */
  footerSlot?: React.ReactNode;
}) {
  const isOn = coworker.status === "on";
  const recentRun = coworker.recentRuns?.[0];
  const hasRuns = Array.isArray(coworker.recentRuns) && coworker.recentRuns.length > 0;
  const coworkerUsers = useMemo<CoworkerPerson[]>(() => {
    const creatorName = coworker.createdByNameSnapshot?.trim();
    const creatorIndex = (coworker.usedBy ?? EMPTY_USED_BY).findIndex((person) =>
      coworker.createdByUserId
        ? person.id === coworker.createdByUserId
        : creatorName
          ? person.name.trim().toLocaleLowerCase() === creatorName.toLocaleLowerCase()
          : false,
    );
    const users = (coworker.usedBy ?? EMPTY_USED_BY).map((person, index) =>
      index === creatorIndex
        ? Object.assign({}, person, {
            isCreator: true,
            isFormerMember:
              coworker.visibility === "workspace" && coworker.creatorIsActiveMember === false,
          })
        : person,
    );

    if (!creatorName || creatorIndex >= 0) {
      return sortCoworkerPeople(users);
    }

    return sortCoworkerPeople([
      {
        id: coworker.createdByUserId ?? `creator:${creatorName}`,
        name: creatorName,
        image: coworker.createdByAvatarSnapshot,
        isCreator: true,
        isFormerMember:
          coworker.visibility === "workspace" && coworker.creatorIsActiveMember === false,
      },
      ...users,
    ]);
  }, [
    coworker.createdByAvatarSnapshot,
    coworker.createdByNameSnapshot,
    coworker.createdByUserId,
    coworker.creatorIsActiveMember,
    coworker.usedBy,
    coworker.visibility,
  ]);

  return (
    <>
      {/* Header: avatar + name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <CoworkerAvatar
            username={coworker.username}
            size={36}
            className="shrink-0 rounded-full"
          />
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm leading-tight font-medium">
              {getCoworkerDisplayName(coworker.name)}
            </p>
            {coworker.username ? (
              <p className="text-muted-foreground bg-muted/60 inline-flex rounded-full px-2 py-0.5 font-mono text-[10px]">
                @{coworker.username}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actionsSlot}
          {statusSlot ?? (
            <div
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                isOn
                  ? "border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-border bg-muted/60 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isOn ? "bg-green-500" : "bg-muted-foreground/40",
                )}
              />
              {isOn ? "On" : "Off"}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {coworker.description ? (
        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {coworker.description}
        </p>
      ) : null}

      {/* Badges: trigger + shared + extras */}
      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {getCoworkerTriggerLabel(coworker.triggerType, coworker.schedule)}
        </span>
        <span className="text-foreground/70 bg-foreground/[0.06] inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
          {coworker.visibility === "workspace" || coworker.sharedAt ? (
            <T>Workspace</T>
          ) : (
            <T>Private</T>
          )}
        </span>
        {badgesSlot}
      </div>

      {/* Run activity + users */}
      <div className="mt-auto flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          {runsSlot ??
            (hasRuns ? (
              <div className="text-muted-foreground/70 truncate text-xs">
                {recentRun ? (
                  <span>
                    <T>Last run:</T>{" "}
                    <span className="text-muted-foreground">
                      {getCoworkerRunStatusLabel(recentRun.status)}
                    </span>{" "}
                    · {formatDate(recentRun.startedAt) ?? "—"}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="text-muted-foreground/70 text-xs">
                <span>
                  <T>No runs yet</T>
                </span>
              </div>
            ))}
        </div>
        {footerSlot ?? <CoworkerUsers users={coworkerUsers} />}
      </div>
    </>
  );
}
