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
