type StartMenuUtilityId = "about-this-pc" | "force-quit";

interface StartMenuActionContext {
  commands: Readonly<Record<string, string>>;
  sessionActionIds: ReadonlySet<string>;
  hideMenu: () => void;
  showRecentItemsMenu: () => void;
  openUtility: (utility: StartMenuUtilityId) => void;
  runCommand: (command: string) => void;
  reportMissingCommand: (itemId: string) => void;
  reportCommandError: (itemId: string, error: unknown) => void;
}

export function dispatchStartMenuAction(
  itemId: string,
  context: StartMenuActionContext,
): void {
  if (itemId === "recent-items") {
    context.showRecentItemsMenu();
    return;
  }

  if (itemId === "force-quit" || itemId === "about-this-pc") {
    context.hideMenu();
    context.openUtility(itemId);
    return;
  }

  const command = context.commands[itemId];
  if (!command) {
    context.reportMissingCommand(itemId);
    context.hideMenu();
    return;
  }

  const hidesBeforeDispatch = context.sessionActionIds.has(itemId);
  if (hidesBeforeDispatch) context.hideMenu();

  try {
    context.runCommand(command);
  } catch (error) {
    context.reportCommandError(itemId, error);
  }

  if (hidesBeforeDispatch === false) context.hideMenu();
}
