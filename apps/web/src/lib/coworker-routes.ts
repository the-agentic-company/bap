type CoworkerRouteTarget = {
  id: string;
  username?: string | null;
};

export function getCoworkerRouteSlug(coworker: CoworkerRouteTarget) {
  return encodeURIComponent(coworker.username || coworker.id);
}

export function getCoworkerEditHref(coworker: CoworkerRouteTarget) {
  return `/agents/edit/${getCoworkerRouteSlug(coworker)}`;
}

export function getCoworkerEditHrefById(coworker: Pick<CoworkerRouteTarget, "id">) {
  return `/agents/edit/${encodeURIComponent(coworker.id)}`;
}

export function getCoworkerInfoHref(coworker: CoworkerRouteTarget) {
  return `/agents/info/${getCoworkerRouteSlug(coworker)}`;
}
