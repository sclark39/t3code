import { useAtomValue } from "@effect/atom-react";
import {
  providerInstanceLookKey,
  providerInstanceLooks,
} from "@t3tools/client-runtime/state/provider-instance-display";
import { Atom } from "effect/reactivity";
import {
  BriefcaseIcon,
  BugIcon,
  Building2Icon,
  CoffeeIcon,
  CrownIcon,
  FlameIcon,
  FlaskConicalIcon,
  Gamepad2Icon,
  GemIcon,
  GhostIcon,
  GlobeIcon,
  HeartIcon,
  HouseIcon,
  LeafIcon,
  type LucideIcon,
  MoonIcon,
  RocketIcon,
  ShieldIcon,
  StarIcon,
  TerminalIcon,
  UserIcon,
  ZapIcon,
} from "lucide-react";

import { environmentPresentations } from "~/state/presentation";

/** The `icon` value that keeps the provider's logo and draws it in the accent color. */
export const TINTED_PROVIDER_LOGO = "tinted";

export const PROVIDER_INSTANCE_GLYPHS: ReadonlyMap<
  string,
  { readonly label: string; readonly Icon: LucideIcon }
> = new Map([
  ["user", { label: "Person", Icon: UserIcon }],
  ["briefcase", { label: "Briefcase", Icon: BriefcaseIcon }],
  ["house", { label: "House", Icon: HouseIcon }],
  ["building", { label: "Building", Icon: Building2Icon }],
  ["star", { label: "Star", Icon: StarIcon }],
  ["heart", { label: "Heart", Icon: HeartIcon }],
  ["zap", { label: "Bolt", Icon: ZapIcon }],
  ["rocket", { label: "Rocket", Icon: RocketIcon }],
  ["flask", { label: "Flask", Icon: FlaskConicalIcon }],
  ["bug", { label: "Bug", Icon: BugIcon }],
  ["terminal", { label: "Terminal", Icon: TerminalIcon }],
  ["globe", { label: "Globe", Icon: GlobeIcon }],
  ["shield", { label: "Shield", Icon: ShieldIcon }],
  ["flame", { label: "Flame", Icon: FlameIcon }],
  ["leaf", { label: "Leaf", Icon: LeafIcon }],
  ["moon", { label: "Moon", Icon: MoonIcon }],
  ["gem", { label: "Gem", Icon: GemIcon }],
  ["crown", { label: "Crown", Icon: CrownIcon }],
  ["ghost", { label: "Ghost", Icon: GhostIcon }],
  ["coffee", { label: "Coffee", Icon: CoffeeIcon }],
  ["gamepad", { label: "Gamepad", Icon: Gamepad2Icon }],
]);

const providerInstanceLooksAtom = Atom.make((get) =>
  providerInstanceLooks(
    [...get(environmentPresentations.providersByEnvironmentAtom).values()].flat(),
  ),
).pipe(Atom.withLabel("provider-instance-looks"));

/** Provider statuses change on every push, so each part is read on its own to stay stable. */
export function useProviderInstanceLook(driverKind: string, displayName: string) {
  const key = providerInstanceLookKey(driverKind, displayName);
  const initials = useAtomValue(providerInstanceLooksAtom, (looks) => looks.get(key)?.initials);
  const icon = useAtomValue(providerInstanceLooksAtom, (looks) => looks.get(key)?.icon);
  return { initials, icon };
}
