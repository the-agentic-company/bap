export type NavigateLike = (options: { to: "/chat" }) => void | Promise<void>;

export function openNewChat(navigate: NavigateLike) {
  window.dispatchEvent(new CustomEvent("new-chat"));
  void navigate({ to: "/chat" });
}
