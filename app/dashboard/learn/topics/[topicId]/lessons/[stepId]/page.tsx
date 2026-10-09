import { notFound } from "next/navigation";

import { LessonScreen } from "@/components/learning/LessonScreen";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One lesson, full screen. The data is fetched on the client (online-only). */
export default function LessonPage({ params }: { params: { topicId: string; stepId: string } }) {
  if (!UUID.test(params.topicId) || !UUID.test(params.stepId)) notFound();
  return <LessonScreen topicId={params.topicId} stepId={params.stepId} />;
}
