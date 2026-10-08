import { kvGet } from "./db";
import { useLocal } from "./session";
import type { Opt } from "./components/ui";

export type Choices = Record<string, Opt[]>;

export function useChoices() {
  const [c] = useLocal(() => kvGet<Choices>("choices"));
  const list = (key: string): Opt[] => c?.[key] || [];
  const label = (key: string, value: string | null | undefined) => (value ? list(key).find((o) => o.value === value)?.label ?? value : "");
  return { list, label };
}
