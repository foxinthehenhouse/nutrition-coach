import { Redirect } from "expo-router";

export default function WhoopRedirect() {
  return <Redirect href="/(onboarding)?startStep=3" />;
}
