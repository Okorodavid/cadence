import { redirect } from "next/navigation";

/** The calendar is the home screen. Not a prompt box. */
export default function Home() {
  redirect("/calendar");
}
