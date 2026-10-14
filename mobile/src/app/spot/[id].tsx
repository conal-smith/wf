import { useLocalSearchParams } from "expo-router";
import { SpotScreen } from "../../features/spot/SpotScreen";

/** /spot/<id>, and /spot/<id>?t=<iso> to open on that hour. */
export default function SpotRoute() {
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  return <SpotScreen key={id} id={id} t={t} />;
}
