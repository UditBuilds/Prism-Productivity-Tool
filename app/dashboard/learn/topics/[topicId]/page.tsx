import { notFound } from "next/navigation";

import { TopicScreen } from "@/components/learning/TopicScreen";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A topic's step list. The data is fetched on the client (online-only). */
export default function TopicPage({ params }: { params: { topicId: string } }) {
  if (!UUID.test(params.topicId)) notFound();
  return <TopicScreen topicId={params.topicId} />;
}
