import { DemoWorkspace } from "../demo-workspace";
import { demoTasks } from "@/lib/ui-demo";

export default function SubagentsPreview() {
  return <DemoWorkspace task={demoTasks[1]} />;
}
