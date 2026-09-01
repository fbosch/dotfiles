import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Spacer, Text } from "@earendil-works/pi-tui";

export const MODAL_WIDTH = 72;
export const MODAL_MAX_VISIBLE_ITEMS = 15;
export const MODAL_FIXED_ROWS = 10;

export function modalSelectedRow(theme: Theme, text: string): string {
  return theme.inverse(theme.fg("accent", text));
}

export function modalSelectListTheme(theme: Theme) {
  return {
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => modalSelectedRow(theme, text),
    description: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
  };
}

export class ModalFrame extends Box {
  constructor(protected readonly theme: Theme) {
    super(1, 0, (text) => theme.bg("selectedBg", text));
  }

  protected setFrame(title: string, body: Component[], footer: string): void {
    const border = () => new DynamicBorder((text) => this.theme.fg("borderAccent", text));

    this.clear();
    this.addChild(border());
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.bold(this.theme.fg("accent", title)), 0, 0));
    this.addChild(new Spacer(1));
    for (const component of body) this.addChild(component);
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg("dim", footer), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(border());
  }
}
