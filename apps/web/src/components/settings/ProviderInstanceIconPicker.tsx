import type { ReactNode } from "react";

import { PROVIDER_INSTANCE_GLYPHS, TINTED_PROVIDER_LOGO } from "../chat/providerInstanceLook";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";

const ICON_CHOICES: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "", label: "Provider logo" },
  { value: TINTED_PROVIDER_LOGO, label: "Provider logo in the accent color" },
  ...Array.from(PROVIDER_INSTANCE_GLYPHS, ([value, glyph]) => ({ value, label: glyph.label })),
];

export function ProviderInstanceIconPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  /** Draws this instance with the given icon choice; an empty choice is the provider's logo. */
  readonly renderIcon: (icon: string) => ReactNode;
  readonly onCommit: (value: string) => void;
}) {
  const value = props.value ?? "";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost-muted"
            aria-label={`Change icon for ${props.displayName}`}
          >
            {props.renderIcon(value)}
          </Button>
        }
      />
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="compact">
        <div className="grid grid-cols-6 gap-1">
          {ICON_CHOICES.map((choice) => (
            <PopoverClose
              key={choice.value}
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant={choice.value === value ? "outline" : "ghost-muted"}
                  aria-label={choice.label}
                  aria-pressed={choice.value === value}
                  title={choice.label}
                  onClick={() => props.onCommit(choice.value)}
                >
                  {props.renderIcon(choice.value)}
                </Button>
              }
            />
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
