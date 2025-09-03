import { Redirect } from "expo-router";

export default function Index() {
  // Use declarative redirect to avoid navigating before root layout mounts
  return <Redirect href="/servers" />;
}
